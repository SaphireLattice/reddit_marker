namespace Marker.Common {
    export let Side: string = "unknown";
    export function SetSide(name: string) {
        return Side = name;
    }
    export function IsContent() {
        return Side == "content";
    }
    export function IsBackground() {
        return Side == "background";
    }
}