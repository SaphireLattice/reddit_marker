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
    let RefreshActive: boolean = false;
    export function TryRefresh() {
        if (RefreshActive) {
            return;
        }
        if (RefreshTimeout) {
            clearTimeout(RefreshTimeout);
        }
        RefreshTimeout = setTimeout(() => DoFullRefresh(), 4000);
    }

    export async function DoFullRefresh() {
        if (RefreshActive) {
            console.error("A refresh is already active!");
            return;
        }
        RefreshTimeout = null;
        RefreshActive = true;
        Tags!.refresh(Database);
        const usersDb = await Database.getList<Data.DbUser>("users");
        let promises: Promise<any>[] = []

        console.log("Started full user tags refresh");
        if (Marker.Common.RequestsActive) {
            console.warn(`Network requests in progress: ${Marker.Common.RequestsActive}. Some users will be refreshed later!`);
        }

        for (let i = 0; i < usersDb.length; i++) {
            const username: string = usersDb[i].username;
            const promise = (Users[username] ? Promise.resolve(Users[username]) :
                new Data.User(username, Users).init(Database))
            .then(user => user.refreshDone)
            .then((user: Data.User) => user.refreshTags(Database))
            .catch((error: Error) => {
                console.error(error);
                if (typeof error === "object" && error.message && error.message.startsWith(""))
                    return [];
                else
                    throw error;
            })
            .then((tags: Marker.Data.DbUserTags[]) => {
                if (tags.length <= 0) {
                    return;
                }

                console.log(`Refreshed tags for ${username}`, tags);

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
        try {
            const result = await Promise.all(promises);
            console.log("Tag refresh done");
            RefreshActive = false;
            return result;
        } catch (error) {
            console.error("Unrecoverable tag refresh error", error);
            RefreshActive = false;
            return Promise.reject(error);
        }
    }
}