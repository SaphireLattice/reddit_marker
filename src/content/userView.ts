namespace Marker.UserView {
    let ViewedUsername: string;
    let ViewedUserStats: Marker.Data.DbUserStats[] = [];
    let StatsList: HTMLDivElement;
    let RefreshButton: HTMLButtonElement;
    let SortSelect: HTMLSelectElement;
    let UsernameField: HTMLInputElement;
    let Controls: Map<string, HTMLInputElement> = new Map();

    function Init() {
        document.getElementsByTagName("form")[0].addEventListener("submit", (ev) => ev.preventDefault());

        RefreshButton = <HTMLButtonElement> document.getElementById("refresh")!;
        UsernameField = <HTMLInputElement> document.getElementById("username")!;
        ViewedUsername = UsernameField.value;
        StatsList = <HTMLDivElement> document.getElementById("stats")!;
        SortSelect = <HTMLSelectElement> document.getElementById("sort")!;

        UsernameField.addEventListener("change", (ev) => {
            while (StatsList.firstChild != null) StatsList.removeChild(StatsList.firstChild);
            ViewedUsername = UsernameField.value;
            new Messaging.Message(ViewedUsername, Messaging.Types.GET_USER_STATS)
                .send().then((user: any) => ViewUser(user.stats));
            StatsList.childNodes.forEach((node) => StatsList.removeChild(node));
            StatsList.innerHTML = "Loading...<br>(no fake loading animation yet)";
        });
        if (ViewedUsername != "") {
            while (StatsList.firstChild != null) StatsList.removeChild(StatsList.firstChild);
            ViewedUsername = UsernameField.value;
            new Messaging.Message(ViewedUsername, Messaging.Types.GET_USER_STATS)
                .send().then((user: any) => ViewUser(user.stats));
            StatsList.childNodes.forEach((node) => StatsList.removeChild(node));
            StatsList.innerHTML = "Loading...<br>(no fake loading animation yet)";
        }

        SortSelect.addEventListener("input", (ev) => {
            ViewRefresh();
        });

        RefreshButton.addEventListener("click", () => {
            while (StatsList.firstChild != null) StatsList.removeChild(StatsList.firstChild);
            new Messaging.Message(ViewedUsername, Messaging.Types.GET_USER_STATS)
                .send().then((user: any) => ViewUser(user.stats));
            StatsList.childNodes.forEach((node) => StatsList.removeChild(node));
            StatsList.innerHTML = "Loading...<br>(no fake loading animation yet)";
        });
    }

    function ViewUser(userStats: any) {
        ViewedUserStats = [];
        for (const subreddit in userStats) {
            if (userStats.hasOwnProperty(subreddit)) {
                ViewedUserStats.push(userStats[subreddit]);
            }
        }
        ViewRefresh();
    }
    function ViewRefresh() {
        while (StatsList.firstChild != null) StatsList.removeChild(StatsList.firstChild);

        let sorter: (a: Marker.Data.DbUserStats, b: Marker.Data.DbUserStats) => number;
        switch(SortSelect.value) {
            default:
            case "score (desc)":
                sorter = (a, b) => {
                    let scoreA = a.commentKarma + a.linkKarma;
                    let scoreB = b.commentKarma + b.linkKarma;
                    return scoreB - scoreA;
                };
                break;
            case "score (asc)":
                sorter = (a, b) => {
                    let scoreA = a.commentKarma + a.linkKarma;
                    let scoreB = b.commentKarma + b.linkKarma;
                    return scoreA - scoreB;
                };
                break;
            case "sub name":
                sorter = (a, b) => a.subreddit > b.subreddit ? 1 : -1;
                break;
        }
        console.log(`Sorting as: "${SortSelect.value}" with`, sorter);
        ViewedUserStats.slice()
            .sort(sorter)
            .forEach((stat) => {
                const elem: HTMLDivElement = document.createElement("div");
                elem.classList.add("stat");
                const line = [];
                line[0] = document.createElement("span");
                line[1] = document.createElement("span");
                line[2] = document.createElement("span");

                line[0].textContent = stat.subredditDisplay;
                line[0].classList.add("subreddit");
                line[1].textContent =
                    `${stat.commentCount} comment${stat.commentCount == 1 ? "" : "s"} ` +
                    `with total score of ${stat.commentKarma} ` +
                    `(avg ${(stat.commentKarma / stat.commentCount).toFixed(2)})`

                line[2].textContent =
                    (stat.linkCount == 0 ? "no posts" : (`${stat.linkCount} posts with total score of ${stat.linkKarma} ` +
                    `(avg ${(stat.linkKarma / stat.linkCount).toFixed(2)}`));

                elem.appendChild(line[0]);
                elem.appendChild(line[1]);
                elem.appendChild(line[2]);

                StatsList.appendChild(elem);
            });
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