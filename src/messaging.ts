namespace Marker.Messaging {
    export let Listeners: Message[] = [];

    export interface UserTagEntry<Data = any> {
        tagId: number;
        tagName: string;
        tagColor: string;
        tagData: Data;
        updated: number;
    }

    export interface UserTag {
        username: string;
        tags: UserTagEntry[];
    }

    // Shorthands:
    // Background -> Content = Content
    // Content -> Background = Bg;
    export enum Types {
        USER_TAGS = "user_tags", // Content -> Tags for users as needed
        USERS_INFO = "users_info" // Bg -> Reports all visible users on page
    }

    export class Message<Data = any, Response = any> {
        private listener: (any);
        constructor(
            public data: Data,
            public type: string,
            public sender?: browser.runtime.MessageSender,
            private nonce?: number)
        {
            this.nonce = nonce ? nonce : window.crypto.getRandomValues(new Uint32Array(1))[0];
        };

        send(replyType: string = this.type): Promise<Response> {
            if (this.sender) {
                throw new Error("Sending is used to start messaging chain, use reply instead");
            }
            if (Marker.Common.IsContent()) {
                return new Promise((resolve, reject) => {
                    browser.runtime.sendMessage({
                        data: this.data,
                        type: this.type,
                        nonce: this.nonce
                    });
                    this.listener = (message: Message<Response, any>) => {
                        if (this.nonce == message.nonce) {
                            if (message.type.toLowerCase() == replyType.toLowerCase()) {
                                browser.runtime.onMessage.removeListener(this.listener);
                                resolve(message.data);
                            } else {
                                reject(message);
                            }
                        }
                    }
                    browser.runtime.onMessage.addListener(this.listener);
                });
            } else {
                // Current problem: getting the promise to work
                throw new Error("Sending messages outside of content context is not supported");
            }
        }

        reply(response: Response | any, success: boolean = true, type: string = this.type) {
            if (success) {
                if (Marker.Common.IsBackground()) {
                    browser.tabs.sendMessage(this.sender!.tab!.id!,
                    {
                        data: response,
                        type: type,
                        nonce: this.nonce
                    })
                } else {
                    throw new Error("Replying to background messages is not supported");
                }
            }
        }
    }
}