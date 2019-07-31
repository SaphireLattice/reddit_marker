namespace Marker.Content {
    /*
    How it should work:
    1. Content is opened, loaded, script runs
    2. Grab all elegible elements, filter them further and store them in Map<User, Elements[]>
    3. Send list of all seen users to BG
    4. Wait for messages from background with tags, might never happen
    5. (Somehow?) scan for new links and updates
     */

    Marker.Common.SetSide("content");
    const KnownSymbol = Symbol("known");
    const Known: Map<string, Element[]> = new Map();

    function Init() {
        browser.runtime.onMessage.addListener(HandleMessages);

        ScanPage();
    }

    function HandleMessages(msgRaw: any, sender: browser.runtime.MessageSender) {
        if (sender.id != Marker.Common.AddonId) {
            // Not from out own addon. Content script MUST NOT handle inter-addon communication.
            return;
        }
        let msg: Marker.Messaging.Message<any, any> =
            new Marker.Messaging.Message(msgRaw.data, msgRaw.type, sender, msgRaw.nonce)
        if (msg.type == Marker.Messaging.Types.USER_TAGS) {
            console.log("Got tags:", msg.data);
        }
    }


    interface AnalysableElement extends Element {
        [KnownSymbol]?: boolean;
    }
    // Pass: /user/username, user/username/, etc
    // Don't pass: /user/username/upvotes, etc
    function ParseNode(node: AnalysableElement, known: Map<string, Element[]>, newKnown: string[]) {
        if (node[KnownSymbol]) {
            return;
        }
        let text = node.textContent!;
        const hrefAttribute: Attr = (<any> node.attributes)["href"];
        const href: string | null = hrefAttribute ? hrefAttribute.value : null;
        if (text.toLowerCase().startsWith("u/")) {
            text = text.substr(2);
        }
        const lowText = text.toLowerCase();

        if (href) {
            var userIndex = href.indexOf("user/")
            var secondLastSlash = href.lastIndexOf("/", href.length - 2);
            if ((userIndex + 4) != secondLastSlash) {
                // This is the case when there's more than one or two slashes after "user/"
                return;
            }
            if (href.substr(secondLastSlash + 1, href.length - secondLastSlash - 2).toLowerCase() != lowText) {
                // The node's text does not match with its link, e.g. link is "/user/username/posts"
                return;
            }
        } else {
            // Non-link nodes are not yet supported for analysis
            return;
        }

        node[KnownSymbol] = true;

        if (known.has(lowText)) {
            let array = known.get(lowText)!;
            array.push(node);
        } else {
            newKnown.push(lowText);
            known.set(lowText, [node]);
        }
    }

    export async function ScanPage() {
        const nodes = document.querySelectorAll("a[href*=\"user/\"]");
        const newKnown: string[] = [];
        nodes.forEach((node) => ParseNode(node, Known, newKnown));
        new Messaging.Message(newKnown, Messaging.Types.USERS_INFO).send();
    }

    if (document.readyState == "complete" || document.readyState == "interactive") {
        Init();
    } else {
        document.addEventListener("DOMContentLoaded", Init);
    }
}