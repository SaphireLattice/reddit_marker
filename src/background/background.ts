namespace Marker.Background {

    browser.browserAction.onClicked.addListener(
        () => browser.tabs.create({ url: "settings.html" })
    );

    browser.runtime.onMessage.addListener(async (msgPlain: any, sender: browser.runtime.MessageSender) => {
        let msg = new Marker.Messaging.Message(
            msgPlain.data,
            msgPlain.type,
            sender,
            msgPlain.nonce
        );
        switch (msg.type) {
            case "get_users":
                break;
            default:
                msg.reply("Unknown message type", false, "unknown_message_type");
                throw new Error(`Unknown message type ${msg.type}`);
        }
    });

    Marker.Database.Init();
}