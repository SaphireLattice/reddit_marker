namespace Marker.Tags {
    const TagTypes: { [type: string]: any } = {};

    export class Instance {
        public tags: Tag[] = [];

        constructor(database: Marker.Database.Instance) {
            database.getList<Marker.Data.DbTag>("tags").then((list) =>
                this.tags = list.map(dbData => new TagTypes[dbData.type](dbData))
            );
        }

        async getEligibleTags(user: Data.User): Promise<Data.DbUserTags[]> {
            if (!user.loaded) {
                throw new Error("User not loaded");
            }
            const promises: Promise<Data.DbUserTags | null>[] = []
            this.tags.forEach(tag => {
                promises.push(tag.check(user))
            });
            return (<Data.DbUserTags[]> (await Promise.all(promises)).filter((tag): boolean => tag != null));
        }
    }

    abstract class Tag<SettingsType = any> {
        public settings: SettingsType;
        constructor(public dbData:  Marker.Data.DbTag<SettingsType>) {
            this.settings = dbData.settings;
        };

        public async check(user: Data.User): Promise<Data.DbUserTags | null> {
            return null;
        };

        public async renderInfo(user: Data.User): Promise<any> {
            return "";
        };
    }

    enum SubActivityMode {
        MODE_OR =           1 << 0, // default AND
        EXCLUDE_KARMA =     1 << 1,
        EXCLUDE_POSTS =     1 << 2,
        EXCLUDE_AVERAGE =   1 << 3,
        // normally uses "above"
        KARMA_BELOW =       1 << 4,
        POSTS_BELOW =       1 << 5,
        AVERAGE_BELOW =     1 << 6,
        IGNORE_LINKS =      1 << 7,
        IGNORE_COMMENTS =   1 << 8,
        INVALID = EXCLUDE_KARMA + EXCLUDE_POSTS + EXCLUDE_AVERAGE,
        INVALID_SOURCE = IGNORE_LINKS + IGNORE_COMMENTS
    }

    interface SubActivitySettings {
        subreddits: string[];
        mode: SubActivityMode;

        karma: number;
        posts: number;
        average: number;
    }

    class SubredditActivity extends Tag<SubActivitySettings> {
        constructor(data: Data.DbTag) {
            super(data);
            if ((this.settings.mode & SubActivityMode.INVALID) == SubActivityMode.INVALID) {
                throw new Error(`No active statistics on the tag "${this.dbData.name}" (${this.dbData.id})`);
            }
            if ((this.settings.mode & SubActivityMode.INVALID_SOURCE) == SubActivityMode.INVALID_SOURCE) {
                throw new Error(`No active sources on the tag "${this.dbData.name}" (${this.dbData.id})`);
            }
        }

        public compare(what: "karma" | "posts" | "average", stat: Data.DbUserStats): boolean {
            const score = (this.settings.mode & SubActivityMode.IGNORE_COMMENTS ? 0 : stat.commentKarma) +
                        (this.settings.mode & SubActivityMode.IGNORE_LINKS ? 0 : stat.linkKarma)
            const count = (this.settings.mode & SubActivityMode.IGNORE_COMMENTS ? 0 : stat.commentCount) +
                        (this.settings.mode & SubActivityMode.IGNORE_LINKS ? 0 : stat.linkCount)
            let below: boolean = false;
            switch (what) {
                case "karma": below = (this.settings.mode & SubActivityMode.KARMA_BELOW) != 0; break;
                case "posts": below = (this.settings.mode & SubActivityMode.POSTS_BELOW) != 0; break;
                case "average": below = (this.settings.mode & SubActivityMode.AVERAGE_BELOW) != 0; break;
            }
            let compare = (left: number, right: number): boolean =>
                !below ? left > right : left < right;
            switch (what) {
                case "karma": return compare(score, this.settings.karma);
                case "posts": return compare(count, this.settings.posts);
                case "average": return compare(score / count, this.settings.average);
            }
        }

        public async check(user: Data.User): Promise<Data.DbUserTags | null> {
            let sortBy: "score" | "posts" | "subreddit" = "score";
            if (this.settings.mode & SubActivityMode.EXCLUDE_KARMA) {
                sortBy = "posts";
            }
            if (this.settings.mode & SubActivityMode.EXCLUDE_AVERAGE) {
                sortBy = "posts";
            }

            let list: {subreddit: string, score: number, posts: number}[] = [];
            for (const subreddit in user.stats) {
                if (this.settings.subreddits.indexOf(subreddit) != -1 && user.stats.hasOwnProperty(subreddit)) {
                    const stat = user.stats[subreddit];
                    let eligible = (this.settings.mode & SubActivityMode.MODE_OR) ? false : true;
                    if (!(this.settings.mode & SubActivityMode.EXCLUDE_KARMA)) {
                        let value = this.compare("karma", stat);
                        eligible = (this.settings.mode & SubActivityMode.MODE_OR) ? (eligible || value) : (eligible && value);
                    }
                    if (!(this.settings.mode & SubActivityMode.EXCLUDE_POSTS)) {
                        let value = this.compare("posts", stat);
                        eligible = (this.settings.mode & SubActivityMode.MODE_OR) ? (eligible || value) : (eligible && value);
                    }
                    if (!(this.settings.mode & SubActivityMode.EXCLUDE_AVERAGE)) {
                        let value = this.compare("average", stat);
                        eligible = (this.settings.mode & SubActivityMode.MODE_OR) ? (eligible || value) : (eligible && value);
                    }
                    if (eligible) {
                        list.push({
                            subreddit: subreddit,
                            score: stat.commentKarma + stat.linkKarma,
                            posts: stat.commentCount + stat.linkCount
                        });
                    }
                }
            }
            if (list.length > 0) {
                list.sort((a, b) => a[sortBy]  == b[sortBy] ? 0 : (a[sortBy] > b[sortBy] ? 1 : -1));
                return {
                    username: user.username,
                    tagId: this.dbData.id,
                    tagData: list,
                    updated: Common.Now()
                };
            }
            return null;
        }
    }
    TagTypes["SubredditActivity"] = SubredditActivity;
}