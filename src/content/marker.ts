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
    const UsernameSymbol = Symbol("username");
    const Known: Map<string, Element[]> = new Map();
    const TagElements: Map<string, Element[]> = new Map();
    const Tags: Map<string, Marker.Messaging.UserTag> = new Map();

    function Init() {
        const markers = document.getElementsByClassName("redditMarker");
        for (let i = 0; i < markers.length; i++) {
            const element = markers[i];
            element.remove();
        }

        Common.addMessageListener(HandleMessages);

        ScanPage();
        setInterval(() => ScanPage(), 2000)
    }

    function HandleMessages(msgRaw: any, sender: browser.runtime.MessageSender) {
        if (sender.id != Marker.Common.AddonId) {
            // Not from out own addon. Content script MUST NEVER handle inter-addon communication.
            return;
        }
        let msg: Marker.Messaging.Message<Marker.Messaging.UserTag, any> =
            new Marker.Messaging.Message(msgRaw.data, msgRaw.type, sender, msgRaw.nonce)
        if (msg.type == Marker.Messaging.Types.USER_TAGS) {
            Tags.set(msg.data.username, msg.data);
            // Delete all existing tag elements
            AttachTags(msg.data);
        }
    }


    interface AnalysableElement extends Element {
        [KnownSymbol]?: boolean;
        [UsernameSymbol]?: string;
    }
    // Pass: /user/username, user/username/, etc
    // Don't pass: /user/username/upvotes, etc
    function ParseNode(node: AnalysableElement, known: Map<string, Element[]>, newKnown: string[], newKnownNodes: Element[]): string | null {
        if (node[KnownSymbol]) {
            return null;
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
                return null;
            }
            if (href.substr(secondLastSlash + 1, href.length - secondLastSlash - 2).toLowerCase() != lowText) {
                // The node's text does not match with its link, e.g. link is "/user/username/posts"
                return null;
            }
        } else {
            // Non-link nodes are not yet supported for analysis
            return null;
        }

        node[KnownSymbol] = true;
        node[UsernameSymbol] = lowText;

        if (known.has(lowText)) {
            let array = known.get(lowText)!;
            array.push(node);
        } else {
            newKnown.push(lowText);
            known.set(lowText, [node]);
        }
        newKnownNodes.push(node);
        return lowText;
    }

    export async function ScanPage() {
        const nodes = document.querySelectorAll("a[href*=\"user/\"]");
        const newKnown: string[] = [];
        const newKnownNodes: AnalysableElement[] = []
        nodes.forEach((node) => ParseNode(node, Known, newKnown, newKnownNodes));
        if (newKnownNodes.length > 0) {
            let attached: string[] = [];
            newKnownNodes.forEach((node) => {
                const username = node[UsernameSymbol]!;
                const tag = Tags.get(username);
                if (attached.indexOf(username) == -1 && tag) {
                    AttachTags(tag);
                    attached.push(username);
                }
            })
        }
        if (newKnown.length > 0) {
            new Messaging.Message(newKnown, Messaging.Types.USERS_INFO).send();
        }
    }

    export async function AttachTags(tagsData: Marker.Messaging.UserTag) {
        let existing = TagElements.get(tagsData.username);
        if (existing) {
            existing.forEach((elem) => elem.remove());
        }
        let userLinks = Known.get(tagsData.username);
        if (!userLinks) {
            // We do not know this user in context of this page!
            // Nothing to attach to.
            return;
        }
        existing = [];
        userLinks.forEach(link => {
            let wrapper = document.createElement("div");
            wrapper.style.display = "inline";
            link.parentNode!.parentNode!.insertBefore(wrapper, link.parentNode);
            tagsData.tags.forEach(tag => {
                const span = document.createElement("span");
                span.classList.add("redditMarker");
                span.style.color = "#878A8C";
                span.style.fontSize = "12px";
                span.style.lineHeight = "16px";
                span.style.fontWeight = "400";
                span.style.margin = "0px 4px";
                span.style.padding = "0px 2px";
                span.style.borderStyle = "solid"
                span.style.borderWidth = "1px";
                span.style.borderRadius = "2px";
                span.style.borderColor = tag.tagColor;

                span.textContent = tag.tagName;

                span.addEventListener('mouseenter', (event) => TagPopup(event, span, tag));
                wrapper.appendChild(span);
                existing!.push(span);
            })
            existing!.push(wrapper);
        });
        TagElements.set(tagsData.username, existing);
    }

    // Rudimentary, but ok enough for now
    // Need to make proper UI later
    export async function TagPopup(event: MouseEvent, element: Element, tag: Marker.Messaging.UserTagEntry) {
        let removed = false;
        const main = document.createElement("span");
        main.style.marginLeft = "4px";
        main.classList.add("rmPopup");
        const remove = (event: Event) => {
            if (removed) return;
            main.parentNode!.removeChild(main);
            removed = true;
        };
        element.addEventListener('mouseleave', (event) => remove(event));

        main.textContent = `${tag.tagData[0].subreddit} - ${tag.tagData[0].score}/${tag.tagData[0].posts}`;

        element.appendChild(main);

        event.stopImmediatePropagation();
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