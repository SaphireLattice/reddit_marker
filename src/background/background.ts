namespace Marker.Background {
    Marker.Common.SetSide("background");

    export const Database = new Marker.Database.Instance("RedditMarker", 1,
    [
        {
            name: "posts", version: 1,
            columns: [
                "id", // A tX_XXXXXX ID string
                {
                    name: "author",
                    version: 1,
                    foreignTable: "users"
                },
                "subreddit",    // lowercase
                "created",      // unix timestamp
                "score",        // number
                "controversiality",     // number
                "quarantine",   // boolean
                "nsfw",         // boolean
                "updated",
                {
                    name: "linkId",
                    version: 1,
                    nullable: true
                }
            ]
        },
        {
            name: "users", version: 1,
            columns: [
                "username",
                "displayUsername",  // username with case as it is displayed
                "profileName",      // Name displayed on the profile
                "profileDescription",
                "created",
                "linkKarma",        // as reported by Reddit
                "commentKarma",
                "followers",
                {
                    name: "updated",
                    version: 1
                },
                {
                    name: "lastLink",
                    version: 1,
                    foreignTable: "posts",
                    nullable: true
                },
                {
                    name: "lastComment",
                    version: 1,
                    foreignTable: "posts",
                    nullable: true
                }
            ]
        },
        {
            name: "stats", version: 1,
            primaryKeys: ["username", "subreddit"],
            columns: [
                {
                    name: "username",
                    version: 1,
                    foreignTable: "users"
                },
                "subreddit",
                {
                    name: "subredditDisplay",
                    version: 1
                },
                "linkKarma",
                "linkCount",
                "commentKarma",
                "commentCount",
                "updated"
            ]
        },
        {
            name: "tags", version: 1,
            columns: [
                "id",
                "name",
                "color",
                "type",
                "settings",
                "updated"
            ]
        },
        {
            name: "userTags", version: 1,
            primaryKeys: ["username", "tagId"],
            columns: [
                {
                    name: "username",
                    version: 1,
                    foreignTable: "users"
                },
                {
                    name: "tagId",
                    version: 1,
                    foreignTable: "tags"
                },
                {
                    name: "tagData",
                    version: 1,
                    nullable: true
                },
                "updated"
            ]
        }
    ]);
    export let Tags: Tags.Instance | null = null;
    Database.init().then((db) => Tags = new Marker.Tags.Instance(db));

    Common.browserAction.onClicked.addListener(
        () => Common.tabs.create({ url: "settings.html" })
    );

    export const Users: { [name: string]: Data.User} = {};

    Common.addMessageListener((msgPlain: any, sender: browser.runtime.MessageSender) => {
        let msg = new Marker.Messaging.Message(
            msgPlain.data,
            msgPlain.type,
            sender,
            msgPlain.nonce
        );
        switch (msg.type) {
            case Messaging.Types.USERS_INFO:
                if (msg.data.length <= 0)
                    return;
                console.log(msg.data);
                (<string[]> msg.data).forEach(username =>
                    (Users[username] || new Data.User(username, Users))
                    .init(Database)
                    .then(async (user) =>
                    {
                        return user.tags;
                    }).then((tags: Data.DbUserTags[]) => {
                        if (tags.length <= 0)
                            return;
                        console.log(username, tags);
                        Common.tabsSendMessage(sender!.tab!.id!,
                        {
                            data: {
                                username: username,
                                tags: tags.map((tag): any =>
                                    ({
                                        tagId: tag.tagId,
                                        tagName: Tags!.tags.filter(t => t.dbData.id == tag.tagId)[0].dbData.name,
                                        tagColor: Tags!.tags.filter(t => t.dbData.id == tag.tagId)[0].dbData.color,
                                        tagData: tag.tagData,
                                        updated: tag.updated
                                    }))
                            },
                            type: Marker.Messaging.Types.USER_TAGS,
                            nonce: window.crypto.getRandomValues(new Uint32Array(1))[0]
                        })
                    })
                );
                break;
            case Messaging.Types.GET_TAGS:
                Database.getList("tags").then(tags => msg.reply(tags));
                break;
            case Messaging.Types.SET_TAG:
                Database.set("tags", msg.data);
                TryRefresh();
                break;
            case Messaging.Types.DELETE_TAG:
                Database.delete("tags", msg.data);
                TryRefresh();
                break;
            default:
                msg.reply(`Unknown message type ${msg.type}`, false, "unknown_message_type");
                console.error(`Unknown message type ${msg.type}`);
                throw new Error(`Unknown message type ${msg.type}`);
        }
    });

    let RefreshTimeout: any;
    export function TryRefresh() {
        if (RefreshTimeout) {
            clearTimeout(RefreshTimeout);
        }
        RefreshTimeout = setTimeout(() => DoFullRefresh(), 4000);
    }

    export async function DoFullRefresh() {
        RefreshTimeout = null;
        const usersDb = await Database.getList<Data.DbUser>("users");
        let promises: Promise<any>[] = []
        for (let i = 0; i < usersDb.length; i++) {
            const username: string = usersDb[i].username;
            const promise = (Users[username] ? Promise.resolve(Users[username]) :
                new Data.User(username, Users).init(Database)).then(user =>
                user.refreshTags(Database)
            ).then(tags => {
                if (tags.length <= 0) {
                    return;
                }

                Common.queryTabs({url: "https://*.reddit.com/*", discarded: false, status: "complete"}).then((tabs) =>
                    tabs.forEach((tab: browser.tabs.Tab | chrome.tabs.Tab) => {
                        Common.tabsSendMessage(tab.id!,
                        {
                            data: {
                                username: username,
                                tags: tags.map((tag): any =>
                                    ({
                                        tagId: tag.tagId,
                                        tagName: Tags!.tags.filter(t => t.dbData.id == tag.tagId)[0].dbData.name,
                                        tagColor: Tags!.tags.filter(t => t.dbData.id == tag.tagId)[0].dbData.color,
                                        tagData: tag.tagData,
                                        updated: tag.updated
                                    }))
                            },
                            type: Marker.Messaging.Types.USER_TAGS,
                            nonce: window.crypto.getRandomValues(new Uint32Array(1))[0]
                        });
                    })
                );
                return tags;
            });
            promises.push(promise);
        }
        return Promise.all(promises);
    }
}

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
        subreddit: RedditSubredditAbout;
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
        public dbUser?: DbUser;
        constructor(public username: string, userList?: {[username: string]: User}) {
            this.username = this.username.toLowerCase();
            if (userList) userList[this.username] = this;
        }

        async init(database: Database.Instance, skipUpdate: boolean = false): Promise<User> {
            if (this.loaded != 0)
                if ((Common.Now() - this.loaded) > USER_RELOAD_TIME)
                    return this;
                else
                    await this.save(database);
            this.dbUser = await database.get<DbUser>("users", this.username);
            this.tags = await database.getList<DbUserTags>("userTags", this.username, "username");
            let dbStats = await database.getList<DbUserStats>("stats", this.username, "username");
            dbStats.forEach((stat) => this.stats[stat.subreddit] = stat);
            if (!this.dbUser || (!skipUpdate && ((Common.Now() - this.dbUser.updated) > USER_ABOUT_CACHING_TIME)) ) {
                await this.update(database);
                if (!this.dbUser) {
                    throw new Error("No database user info after fetching about");
                }
                await this.save(database);
                // Set load time because if we get this user again,
                //  then it might try to re-scan it again while in
                //  the process of scanning it already, wasting data
                //  in the process. This way copy will prematurely
                //  exit without data, but existing one will return
                //  and correctly signal its tags (if any).
                this.loaded = Common.Now();
                await this.onlineAnalyze(database);
                await this.refreshTags(database);
                await this.save(database);
            }
            this.loaded = Common.Now();
            return this;
        }

        async refreshTags(database: Marker.Database.Instance) {
            database.delete("userTags", this.username, "username");
            this.tags = await Marker.Background.Tags!.getEligibleTags(this);
            this.save(database);
            return this.tags;
        }

        async fetch(): Promise<RedditUserAbout> {
            return (await Common.GetHttp<RedditUserAboutWrapper>(
                `/user/${this.username}/about.json`
            )).data;
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
            if (listing.id.startsWith("t1")) {
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

        async onlineAnalyze(database: Database.Instance) {
            console.warn("Online refresh", this.username);
            if (!this.dbUser) {
                throw new Error("No database user info");
            }
            let first: boolean = true;
            let direction: boolean = !(this.dbUser.lastComment);

            let commentsData: RedditListing | null = null;
            while ((commentsData = (await Common.GetHttp<RedditKindWrapper<RedditListing,"Listing">>(
                `/user/${this.username}/comments.json`,
                {
                    t: "all",
                    sort: "new",
                    limit: 100,
                    allow_quarantined: "true",
                    [direction ? "after" : "before"]:
                        direction ?
                            (commentsData ? commentsData.after : null) :
                            (commentsData ? commentsData.before : this.dbUser.lastComment)
                }
            )).data)[direction ? "after" : "before"] != null) {
                if (first) {
                    this.dbUser.lastComment = commentsData.children[0].data.name;
                    first = false
                }
                for (let i = 0; i < commentsData.children.length; i++) {
                    const l = commentsData.children[i];
                    await this.analyzeListing(database, l.data);
                }
            }

            first = true;
            let linkData: RedditListing | null = null;
            while ((linkData = (await Common.GetHttp<RedditKindWrapper<RedditListing,"Listing">>(
                `/user/${this.username}/submitted.json`,
                {
                    t: "all",
                    sort: "new",
                    limit: 100,
                    allow_quarantined: "true",
                    [direction ? "after" : "before"]:
                        direction ?
                            (linkData ? linkData.after : null) :
                            (linkData ? linkData.before : this.dbUser.lastLink)
                }
            )).data)[direction ? "after" : "before"] != null) {
                if (first) {
                    this.dbUser.lastLink = linkData.children[0].data.name;
                    first = false
                }
                for (let i = 0; i < linkData.children.length; i++) {
                    const l = linkData.children[i];
                    await this.analyzeListing(database, l.data);
                }
            }
        }

        async update(database: Database.Instance) {
            const redditAbout: RedditUserAbout = await this.fetch();
            if (redditAbout.name.toLocaleLowerCase() != this.username) {
                throw new Error(`Username mismatch for user ${this.username} (got ${redditAbout.name}) when getting about.json`);
            }
            this.dbUser = {
                username: this.username,
                displayUsername: redditAbout.name,
                profileName: redditAbout.subreddit.title,
                profileDescription: redditAbout.subreddit.public_description,
                commentKarma: redditAbout.comment_karma,
                linkKarma: redditAbout.link_karma,
                followers: redditAbout.subreddit.subscribers,
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