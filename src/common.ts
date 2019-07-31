namespace Marker.Common {
    export const AddonId: string = "reddit-marker@saphi.re";
    export const DefaultHostname: string = "www.reddit.com";
    export const DefaultProtocol: string = "https://";

    export let Side: string = "unknown";
    export function SetSide(name: string): void {
        Side = name;
    }
    export function IsContent(): boolean {
        return Side == "content";
    }
    export function IsBackground(): boolean {
        return Side == "background";
    }

    export function Now(): number {
        return Date.now() / 1000 | 0
    }

    // TODO: Make this work via content script?
    export async function GetHttp<Type>(
            path: string,
            parameters: any = {},
            responseType: XMLHttpRequestResponseType = "json",
            domain: string = DefaultHostname,
            protocol: string = DefaultProtocol
        ): Promise<Type> {
        return new Promise((resolve, reject) => {
            let url = `${protocol}//${domain}/${path}`;
            let first = true;
            for (const key in parameters) {
                if (parameters.hasOwnProperty(key)) {
                    const element = parameters[key];
                    const isBooleanTrue = typeof element === "boolean" && element;
                    url = `${url}${first ? "?" : "&"}${key}${isBooleanTrue ? "" : `=${String(element)}` }`
                    first = false;
                }
            }
            const request = new XMLHttpRequest();
            request.responseType = responseType;
            request.addEventListener("load", () => resolve(request.response));
            request.addEventListener("error", (error) => reject(error));
            request.open("GET", url);
            request.send();
        });
    }
}