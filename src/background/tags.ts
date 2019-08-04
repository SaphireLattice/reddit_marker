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

        async refresh(database: Marker.Database.Instance) {
            this.tags = [];
            database.getList<Marker.Data.DbTag>("tags").then((list) =>
                this.tags = list.map(dbData => new TagTypes[dbData.type](dbData))
            );
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

    interface SubActivitySettings {
        subreddits: string[];

        conditionsOr: boolean;

        excludeScore: boolean;
        excludePosts: boolean;
        excludeAverage: boolean;

        scoreBelow: boolean;
        postsBelow: boolean;
        averageBelow: boolean;

        ignoreLinks: boolean;
        ignoreComments: boolean;

        global: boolean;

        score: number;
        posts: number;
        average: number;
    }

    class SubredditActivity extends Tag<SubActivitySettings> {
        constructor(data: Data.DbTag) {
            super(data);
            if (this.settings.excludeAverage && this.settings.excludePosts && this.settings.excludeScore) {
                throw new Error(`No active statistics on the tag "${this.dbData.name}" (${this.dbData.id})`);
            }
            if (this.settings.ignoreComments && this.settings.ignoreLinks) {
                throw new Error(`No active sources on the tag "${this.dbData.name}" (${this.dbData.id})`);
            }
        }

        public compareNumber(what: "score" | "posts" | "average", value: number): boolean {
            let below: boolean = false;
            switch (what) {
                case "score": below = this.settings.scoreBelow; break;
                case "posts": below = this.settings.postsBelow; break;
                case "average": below = this.settings.averageBelow; break;
            }
            let compare = (left: number, right: number): boolean =>
                !below ? left > right : left < right;
            switch (what) {
                case "score": return compare(value, this.settings.score);
                case "posts": return compare(value, this.settings.posts);
                case "average": return compare(value, this.settings.average);
            }
        }

        public compare(what: "score" | "posts" | "average", stat: Data.DbUserStats): boolean {
            const score = (this.settings.ignoreComments ? 0 : stat.commentKarma) +
                        (this.settings.ignoreLinks ? 0 : stat.linkKarma)
            const count = (this.settings.ignoreComments ? 0 : stat.commentCount) +
                        (this.settings.ignoreLinks ? 0 : stat.linkCount)

            switch (what) {
                case "score": return this.compareNumber("score", score);
                case "posts": return this.compareNumber("posts", count);
                case "average": return this.compareNumber("average", score / count);
            }
        }

        public async check(user: Data.User): Promise<Data.DbUserTags | null> {
            let sortBy: "score" | "posts" | "subreddit" = "score";
            if (this.settings.excludeScore) {
                sortBy = "posts";
            }
            if (this.settings.excludeAverage) {
                sortBy = "posts";
            }
            let list: {subreddit: string, score: number, posts: number}[] = [];
            if (this.settings.global) {
                let score = 0;
                let posts = 0;
                for (const subreddit in user.stats) {
                    const stat = user.stats[subreddit];
                    const subScore = (this.settings.ignoreComments ? 0 : stat.commentKarma) +
                                (this.settings.ignoreLinks ? 0 : stat.linkKarma)
                    const subPosts = (this.settings.ignoreComments ? 0 : stat.commentCount) +
                                (this.settings.ignoreLinks ? 0 : stat.linkCount)
                    score += subScore;
                    posts += subPosts;
                }
                let eligible = (this.settings.conditionsOr) ? false : true;
                if (!(this.settings.excludeScore)) {
                    let value = this.compareNumber("score", score);
                    eligible = (this.settings.conditionsOr) ? (eligible || value) : (eligible && value);
                }
                if (!(this.settings.excludePosts)) {
                    let value = this.compareNumber("posts", posts);
                    eligible = (this.settings.conditionsOr) ? (eligible || value) : (eligible && value);
                }
                if (!(this.settings.excludeAverage)) {
                    let value = this.compareNumber("average", score / posts);
                    eligible = (this.settings.conditionsOr) ? (eligible || value) : (eligible && value);
                }
                if (eligible) {
                    list.push({
                        subreddit: "all",
                        score: score,
                        posts: posts
                    });
                }
            } else {
                if (this.settings.subreddits.length == 0) {
                    return null;
                }
                for (const subreddit in user.stats) {
                    if (this.settings.subreddits.indexOf(subreddit) != -1 && user.stats.hasOwnProperty(subreddit)) {
                        const stat = user.stats[subreddit];
                        let eligible = (this.settings.conditionsOr) ? false : true;
                        if (!(this.settings.excludeScore)) {
                            let value = this.compare("score", stat);
                            eligible = (this.settings.conditionsOr) ? (eligible || value) : (eligible && value);
                        }
                        if (!(this.settings.excludePosts)) {
                            let value = this.compare("posts", stat);
                            eligible = (this.settings.conditionsOr) ? (eligible || value) : (eligible && value);
                        }
                        if (!(this.settings.excludeAverage)) {
                            let value = this.compare("average", stat);
                            eligible = (this.settings.conditionsOr) ? (eligible || value) : (eligible && value);
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
            }
            if (list.length > 0) {
                // We sort descending, so __smaller__ should be sorted as __bigger__, so with a >0
                list.sort((a, b) => a[sortBy] == b[sortBy] ? 0 : (a[sortBy] > b[sortBy] ? -1 : 1));
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