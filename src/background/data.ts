namespace Marker.Data {
    export const USER_RELOAD_TIME = 60 * 60;
    export const USER_ABOUT_CACHING_TIME = 7 * 24 * 60 * 60;
    export const USER_TAGS_CACHE = 60 * 60;
    const KNOWN_MAX_KARMA_LOSS = 25;

    interface RedditSubredditAbout {
        display_name: string;
        title: string;
        public_description: string;
        subreddit_type: string;
        subscribers: number;
        id: string;
    }

    interface RedditUserAboutWrapper {
        type: string;
        data: RedditUserAbout;
    }
    interface RedditUserAbout {
        subreddit?: RedditSubredditAbout;
        id: string;
        name: string;
        //created: number; // DO NOT USE - local time
        created_utc: number;
        link_karma: number;
        comment_karma: number;
    }

    interface RedditKindWrapper<Type,Kind> {
        kind: Kind;
        data: Type;
    }

    interface RedditListingEntry {
        id: string;
        author: string;
        name: string;
        link_id: string;
        parent_id: string;
        created_utc: number;
        subreddit: string;
        quarantine: boolean;
        score: number;
        controversiality: number;
        over_18: boolean;
    }

    interface RedditListing {
        modhash: string;
        dist: number;
        children: RedditKindWrapper<RedditListingEntry, "t1" | "t3">[];
        after: string | null;
        before: string | null;
    }

    export interface DbPost {
        id: string;
        author: string;
        subreddit: string;
        created: number;
        score: number;
        controversiality: number;
        quarantine: boolean;
        nsfw: boolean;
        updated: number;
        linkId: string | null;
    }

    export interface DbUser {
        username: string;
        displayUsername: string;
        profileName: string;
        profileDescription: string;
        created: number
        linkKarma: number
        commentKarma: number
        followers: number;
        lastLink: string | null;
        lastComment: string | null;
        updated: number;
    }

    export interface DbUserStats {
        username: string;
        subreddit: string;
        subredditDisplay: string;
        linkKarma: number;
        linkCount: number;
        commentKarma: number;
        commentCount: number;
        updated: number;
    }

    export interface DbTag<Settings = any> {
        id: number;
        name: string;
        color: string;
        type: string;
        settings: Settings;
        updated: number;
    }

    export interface DbUserTags<Data = any> {
        username: string;
        tagId: number;
        tagData: Data;
        updated: number;
    }

    export class User {
        public stats: {[subreddit: string]: DbUserStats} = {};
        public tags: DbUserTags[] = [];
        public loaded: number = 0;
        public refreshing: boolean = false;
        public dbUser?: DbUser;
        constructor(public username: string, userList?: {[username: string]: User}) {
            this.username = this.username.toLowerCase();
            if (userList) userList[this.username] = this;
        }

        public refreshDone: Promise<User> = new Promise((resolve, reject) => {
            this.refreshDoneResolve = resolve;
        });
        private refreshDoneResolve?: (user: User) => void;

        async init(database: Database.Instance, skipUpdate: boolean = false): Promise<User> {
            if (this.loaded != 0)
                if ((Common.Now() - this.loaded) > USER_RELOAD_TIME)
                    return this;
                else
                    await this.save(database);
            if (this.refreshing)
                throw new Error(`Refreshing in progress when init was called for ${this.username}`);
            this.dbUser = await database.get<DbUser>("users", this.username);
            this.tags = await database.getList<DbUserTags>("userTags", this.username, "username");
            let dbStats = await database.getList<DbUserStats>("stats", this.username, "username");
            dbStats.forEach((stat) => this.stats[stat.subreddit] = stat);
            await this.refresh(database);
            return this;
        }

        async refresh(database: Database.Instance, skipUpdate: boolean = false) {
            if (!this.dbUser || (!skipUpdate && ((Common.Now() - this.dbUser.updated) > USER_ABOUT_CACHING_TIME)) ) {
                this.refreshing = true;
                this.refreshDone = new Promise((resolve, reject) => {
                    this.refreshDoneResolve = resolve;
                });
                await this.update(database);
                if (!this.dbUser) {
                    throw new Error(`No database user info after fetching about for ${this.username}`);
                }
                await this.save(database);
                // Set load time because if we get this user again,
                //  then it might try to re-scan it again while in
                //  the process of scanning it already, wasting data
                //  in the process. This way copy will prematurely
                //  exit without data, but existing one will return
                //  and correctly signal its tags (if any).
                this.loaded = Common.Now();
                try {
                    await this.onlineAnalyze(database);
                    await this.refreshTags(database, true);
                } catch (error) {
                    console.error(`Error refreshing user ${this.username}`, error);
                    throw error;
                }
                await this.save(database);
                this.refreshing = false;
                this.refreshDoneResolve!(this);
            } else {
                this.refreshDoneResolve!(this);
            }
            this.loaded = Common.Now();
            return this;
        }

        async refreshTags(database: Marker.Database.Instance, ignoreRefresh: boolean = false) {
            if (!ignoreRefresh && this.refreshing) {
                throw new Error(`Full refresh for user ${this.username} is in progress, aborted`, );
            }
            database.delete("userTags", this.username, "username");
            this.tags = await Marker.Background.Tags!.getEligibleTags(this);
            this.save(database);
            return this.tags;
        }

        async fetch(): Promise<RedditUserAbout> {
            let aboutJson = await Common.GetHttp<RedditUserAboutWrapper>(
                `/user/${this.username}/about.json`
            );
            if (!aboutJson.data) {
                console.error(`Fetch for /usr/${this.username}/about.json returned no data`, aboutJson);
                throw new Error(`Fetch for /usr/${this.username}/about.json returned no data`);
            }
            return aboutJson.data;
        }

        async analyzeListing(
                database: Database.Instance,
                listing: RedditListingEntry
            ): Promise<DbPost>
        {
            const post: DbPost = {
                id: listing.name,
                author: this.username,
                subreddit: listing.subreddit.toLowerCase(),
                linkId: listing.link_id,
                score: listing.score,
                controversiality: listing.controversiality || 0,
                created: listing.created_utc,
                quarantine: listing.quarantine,
                nsfw: listing.over_18,
                updated: Common.Now()
            };
            let stat: DbUserStats = this.stats[post.subreddit];
            if (!stat) {
                stat = (this.stats[post.subreddit] = {
                    username: this.username,
                    subreddit: post.subreddit.toLowerCase(),
                    subredditDisplay: post.subreddit,
                    linkCount: 0,
                    linkKarma: 0,
                    commentCount: 0,
                    commentKarma: 0,
                    updated: Common.Now()
                })
            }
            let previous = await database.get<DbPost>("posts", post.id);
            let previousScore = previous ? previous.score : 0;
            if (listing.name.startsWith("t3")) {
                stat.linkCount += previous ? 0 : 1;
                stat.linkKarma += Math.max(post.score - previousScore, -KNOWN_MAX_KARMA_LOSS);
            } else {
                stat.commentCount += previous ? 0 : 1;
                stat.commentKarma += Math.max(post.score - previousScore, -KNOWN_MAX_KARMA_LOSS);
            }
            stat.updated = Common.Now();
            database.set("stats", stat);
            database.set("posts", post);

            return post;
        }

        async listingWalk(listing: 'comments' | 'submitted', direction: boolean, startOn: string | null = null) {
            if (!this.dbUser) {
                throw new Error("No database user info");
            }
            let data = (await Common.GetHttp<RedditKindWrapper<RedditListing,"Listing">>(
                `/user/${this.username}/${listing}.json`,
                {
                    t: "all",
                    sort: "new",
                    limit: 100,
                    allow_quarantined: "true",
                    [direction ? "after" : "before"]: startOn
                }
            )).data
            return {
                children: data.children,
                next: data.children.length > 0 ?
                    (direction ? data.children[data.children.length - 1].data.name : data.children[0].data.name) : null
            };
        }

        async onlineAnalyze(database: Database.Instance) {
            console.warn("Online refresh", this.username);
            if (!this.dbUser) {
                throw new Error("No database user info");
            }

            {
                let direction: boolean = !(this.dbUser.lastComment);
                let next: string | null = this.dbUser.lastComment;
                let first: boolean = true;
                let commentsData;
                while ((commentsData = (await this.listingWalk("comments", direction, next))).next != null) {
                    next = commentsData.next;
                    if (direction && first) {
                        this.dbUser.lastComment = commentsData.children[0].data.name;
                        first = false
                    }
                    for (let i = 0; i < commentsData.children.length; i++) {
                        if (!direction && first) {
                            this.dbUser.lastComment = commentsData.children[0].data.name;
                            first = false
                        }
                        const commentWrapper = commentsData.children[i];
                        await this.analyzeListing(database, commentWrapper.data);
                    }
                    if (!direction) first = true;
                }
            }

            {
                let direction: boolean = !(this.dbUser.lastLink);
                let next: string | null = this.dbUser.lastLink;
                let first: boolean = true;
                let linksData;
                while ((linksData = (await this.listingWalk("submitted", direction, next))).next != null) {
                    next = linksData.next;
                    if (direction && first) {
                        this.dbUser.lastLink = linksData.children[0].data.name;
                        first = false
                    }
                    for (let i = 0; i < linksData.children.length; i++) {
                        if (!direction && first) {
                            this.dbUser.lastComment = linksData.children[0].data.name;
                            first = false
                        }
                        const postWrapper = linksData.children[i];
                        console.log("Analyzing /post/ ", postWrapper.data);
                        await this.analyzeListing(database, postWrapper.data);
                    }
                    if (!direction) first = true;
                }
            }
        }

        async update(database: Database.Instance) {
            const redditAbout: RedditUserAbout = await this.fetch();
            if (redditAbout.name.toLocaleLowerCase() != this.username) {
                throw new Error(`Username mismatch for user ${this.username} (got ${redditAbout.name}) when getting about.json`);
            }
            const userSub = typeof redditAbout.subreddit === "object";
            this.dbUser = {
                username: this.username,
                displayUsername: redditAbout.name,
                profileName: userSub ? redditAbout.subreddit!.title || "" : "",
                profileDescription: userSub ? redditAbout.subreddit!.public_description || "" : "",
                commentKarma: redditAbout.comment_karma,
                linkKarma: redditAbout.link_karma,
                followers: userSub ? redditAbout.subreddit!.subscribers || 0 : 0,
                created: redditAbout.created_utc,
                updated: Common.Now(),
                lastLink: null,
                lastComment: null
            }
        }

        async save(database: Database.Instance) {
            await database.set<DbUser>("users", this.dbUser!);
            for (let i = 0; i < this.tags.length; i++) {
                const tag = this.tags[i];
                await database.set<DbUserTags>("userTags", tag);
            }
        }
    }
}