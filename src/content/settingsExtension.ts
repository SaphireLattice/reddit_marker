namespace Marker.ExtensionSettings {
    let ButtonsMsgMap: { [index: string]: Messaging.Types } = {
        refresh: Messaging.Types.REFRESH_TAGS,
        unload: Messaging.Types.USERS_CACHE_UNLOAD,
        outdate: Messaging.Types.DB_OUTDATE,
        delete: Messaging.Types.DB_RESET
    };

    function Init() {
        document.getElementsByTagName("form")[0].addEventListener("submit", (ev) => ev.preventDefault());

        for (const button in ButtonsMsgMap) {
            if (ButtonsMsgMap.hasOwnProperty(button)) {
                const msg = ButtonsMsgMap[button];
                document.getElementById(button)!.addEventListener("click", () => {
                    new Messaging.Message(null, msg).send();
                })
            }
        }
    }

    if (document.readyState == "complete" || document.readyState == "interactive") {
        // Mostly a debugging thing. The context is
        //  scanned so quickly that the background
        //  does not have time to attach a listener
        //  to handle scan results.
        setTimeout(() => Init(), 100);
    } else {
        document.addEventListener("DOMContentLoaded", Init);
    }
}