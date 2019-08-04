namespace Marker.Settings {
    let ButtonSymbol = Symbol("button");
    let AddButton: HTMLButtonElement;
    let DeleteButton: HTMLButtonElement;
    let TagList: HTMLDivElement;
    let TagButtons: HTMLButtonElement[] = [];
    let Tags: Marker.Data.DbTag[] = [];
    export let ViewedTag: Marker.Data.DbTag;
    let Controls: Map<string, HTMLInputElement> = new Map();
    let ControlNames: string[] = [
        "name",
        "colorBox",
        "color",
        "subreddits",
        "ignoreLinks",
        "ignoreComments",
        "posts",
        "postsDisable",
        "postsAbove",
        "score",
        "scoreDisable",
        "scoreAbove",
        "average",
        "averageDisable",
        "averageAbove"
    ]

    export function Init() {
        document.getElementsByTagName("form")[0].addEventListener("submit", (ev) => ev.preventDefault());

        AddButton = <HTMLButtonElement> document.getElementById("addTagButton")!;
        AddButton.addEventListener("click", () => AddTag());
        DeleteButton = <HTMLButtonElement> document.getElementsByName("delete")[0]!;
        DeleteButton.addEventListener("click", () => DeleteTag(Marker.Settings.ViewedTag));

        TagList = <HTMLDivElement> document.getElementById("tagList")!;

        ControlNames.forEach((name) => Controls.set(name, <HTMLInputElement> document.getElementsByName(name)[0]!));
        new Messaging.Message(null, Messaging.Types.GET_TAGS).send().then((msg) => {
            Tags = msg;
            RefreshList();
            ViewedTag = Tags[0];
            if (!ViewedTag) {
                AddTag();
            } else {
                ViewTag(ViewedTag);
            }
            Controls.forEach(control => control.addEventListener("change", () => {
                RefreshTag(Marker.Settings.ViewedTag);
                UpdateTag(Marker.Settings.ViewedTag);
            }))
        });
    }

    export function ViewTag(tag: Marker.Data.DbTag) {
        ViewedTag = tag;
        Controls.get("name")!.value = tag.name;
        Controls.get("color")!.value = tag.color;
        Controls.get("colorBox")!.style.backgroundColor = tag.color;

        const subreddits: string[] = tag.settings.subreddits;
        Controls.get("subreddits")!.value = subreddits.filter(e => !(!e)).join("\n").trim();
        Controls.get("ignoreLinks")!.checked = tag.settings.ignoreLinks;
        Controls.get("ignoreComments")!.checked = tag.settings.ignorePosts;

        Controls.get("postsDisable")!.checked = tag.settings.excludePosts;
        Controls.get("scoreDisable")!.checked = tag.settings.excludeScore;
        Controls.get("averageDisable")!.checked = tag.settings.excludeAverage;

        Controls.get("posts")!.valueAsNumber = tag.settings.posts;
        Controls.get("score")!.valueAsNumber = tag.settings.score;
        Controls.get("average")!.valueAsNumber = tag.settings.average;

        Controls.get("scoreAbove")!.value = tag.settings.scoreBelow ? "below" : "above";
        Controls.get("postsAbove")!.value = tag.settings.postsBelow ? "below" : "above" ;
        Controls.get("averageAbove")!.value = tag.settings.averageBelow ? "below" : "above";

        Controls.get("posts")!.disabled = tag.settings.excludePosts;
        Controls.get("score")!.disabled = tag.settings.excludeScore;
        Controls.get("average")!.disabled = tag.settings.excludeAverage;

        Controls.get("name")!.value = tag.name;
    }

    export function RefreshTag(tag: Marker.Data.DbTag) {
        tag.name = Controls.get("name")!.value;
        tag.color = Controls.get("color")!.value;
        Controls.get("colorBox")!.style.backgroundColor = tag.color;

        (<any> tag)[ButtonSymbol].textContent = tag.name;
        tag.settings.subreddits = Controls.get("subreddits")!.value.trim().split("\n") .filter(e => !(!e));;
        tag.settings.ignoreLinks = Controls.get("ignoreLinks")!.checked;
        tag.settings.ignorePosts = Controls.get("ignoreComments")!.checked;

        tag.settings.excludePosts = Controls.get("postsDisable")!.checked;
        tag.settings.excludeScore = Controls.get("scoreDisable")!.checked;
        tag.settings.excludeAverage = Controls.get("averageDisable")!.checked;

        tag.settings.posts = Controls.get("posts")!.valueAsNumber;
        tag.settings.score = Controls.get("score")!.valueAsNumber;
        tag.settings.average = Controls.get("average")!.valueAsNumber;

        tag.settings.scoreBelow = Controls.get("scoreAbove")!.value == "below";
        tag.settings.postsBelow = Controls.get("postsAbove")!.value == "below";
        tag.settings.averageBelow = Controls.get("averageAbove")!.value == "below";

        Controls.get("posts")!.disabled = tag.settings.excludePosts;
        Controls.get("score")!.disabled = tag.settings.excludeScore;
        Controls.get("average")!.disabled = tag.settings.excludeAverage;

        Controls.get("postsAbove")!.disabled = tag.settings.excludePosts;
        Controls.get("scoreAbove")!.disabled = tag.settings.excludeScore;
        Controls.get("averageAbove")!.disabled = tag.settings.excludeAverage;
    }

    export function UpdateTag(tag: Marker.Data.DbTag) {
        new Messaging.Message(tag, Messaging.Types.SET_TAG).send();
    }

    export function DeleteTag(tag: Marker.Data.DbTag) {
        new Messaging.Message(tag.id, Messaging.Types.DELETE_TAG).send();
        const button = (<any> tag)[ButtonSymbol];
        const index = TagButtons.indexOf(button);
        if (TagButtons.length == 1) {
            button.remove();
            TagButtons.splice(TagButtons.indexOf(button), 1);
            Tags.splice(Tags.indexOf(tag), 1);
            AddTag();
            return;
        }
        if (index == 0) {
            ViewedTag = (<any> TagButtons[1])[ButtonSymbol];
            button.remove();
            TagButtons.splice(TagButtons.indexOf(button), 1);
            Tags.splice(Tags.indexOf(tag), 1);
        } else {
            ViewedTag = (<any> TagButtons[index - 1])[ButtonSymbol];
            button.remove();
            TagButtons.splice(TagButtons.indexOf(button), 1);
            Tags.splice(Tags.indexOf(tag), 1);
        }
        ViewTag(ViewedTag);
    }

    export function AddTag() {
        ViewedTag = {
            color: "#ff0000",
            type: "SubredditActivity",
            name: "New Tag",
            settings: {
                subreddits: [],

                conditionsOr: false,

                excludeScore: false,
                excludePosts: false,
                excludeAverage: true,

                scoreBelow: false,
                postsBelow: false,
                averageBelow: false,

                ignoreLinks: false,
                ignoreComments: false,

                score: 0,
                posts: 3,
                average: 0
            },
            id: window.crypto.getRandomValues(new Uint32Array(1))[0],
            updated: Common.Now()
        };
        Tags.push(ViewedTag);
        RefreshList();
        ViewTag(ViewedTag);
    }

    export function RefreshList() {
        TagButtons.forEach(button => button.remove());
        const sorted = Tags.slice(0).sort((a,b) => a.updated - b.updated);
        sorted.forEach((tag) => {
            const button = document.createElement("button");
            (<any> button)[ButtonSymbol] = tag;
            button.textContent = tag.name;
            button.addEventListener("click", (event) => ViewTag(tag));
            TagList.insertBefore(button, AddButton);
            TagButtons.push(button);
            (<any> tag)[ButtonSymbol] = button;
        })
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