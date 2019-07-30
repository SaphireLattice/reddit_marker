namespace Marker.Database {
    const CURRENT_VERSION: number = 1;
    let PREVIOUS_VERSION: number = CURRENT_VERSION;
    let Instance: IDBDatabase;

    interface Migration {
        // Upgrades database structure itself
        upgrade: ((event: IDBVersionChangeEvent) => void) | null;
        // Migrates the database data to new structure
        migrate: (event: any) => void;
    }

    interface ColumnDefinition {
        name: string;
        version: number;
        unique?: boolean;
        multiEntry?: boolean;
        // The target of it
        foreignTable?: string;
        nullable?: boolean;
    }

    interface TableDefinition {
        name: string;
        // The db version it first was made at
        version: number;
        // First column is the table key
        columns: (ColumnDefinition | string)[];
    }

    // FK targets and who they come from
    // TODO: make this work with migrations?
    let ForeignKeys: Map<string, string[]> = new Map();

    // They migrate from version [n] to CURRENT
    // Do NOT make it migrate from [n] to [n+1] to ... to CURRENT
    let Migrations: Migration[] = [];
    let Tables: TableDefinition[] = [
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
                "nsfw"          // boolean
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
                "totalKarma",       // as reported by Reddit
                "followers",
            ]
        }
    ]

    function Failure() {
        console.error("Database access request failed. No recovery possible.");
    }

    function Success(event: any) {

        Instance = event.target.result;
        if (PREVIOUS_VERSION == 0 || PREVIOUS_VERSION == CURRENT_VERSION) {
            console.log("Database opened successfully")
            return;
        } else {
            Migrations[PREVIOUS_VERSION].migrate(event);
        }
    }

    function UpgradeNeeded(event: any) {
        Instance = <IDBDatabase> event.target!.result;
        let migration: Migration = Migrations[event.oldVersion];
        if (!migration && event.oldVersion != 0) {
            throw new Error(`No migration available for DB version ${event.oldVersion}`);
        }
        if (migration && migration.upgrade != null) {
            migration.upgrade(event);
        } else {
            Tables.forEach(table => {
                var objectStore = null;
                if (table.version > event.oldVersion) {
                    const firstCol = table.columns[0];
                    objectStore = Instance.createObjectStore(table.name,
                        { keyPath: typeof firstCol === "object" ? firstCol.name : firstCol }
                    );
                } else {
                    objectStore = Instance.transaction(table.name, "versionchange").objectStore(table.name);
                }

                for (let index = 1; index < table.columns.length; index++) {
                    const column = table.columns[index];
                    if (typeof column === "object") {
                        if (column.version > event.oldVersion) {
                            objectStore.createIndex(column.name, column.name, {
                                unique: column.unique == true,
                                multiEntry: column.multiEntry == true
                            });
                        }
                    } else {
                        objectStore.createIndex(column, column);
                    }
                }
            });
        }
        PREVIOUS_VERSION = event.oldVersion;
    }

    export function Init() {
        var request = window.indexedDB.open("RedditMarker", 1);
        request.onerror = Failure;
        request.onupgradeneeded = UpgradeNeeded;
        request.onsuccess = Success;
    }

    export async function Get(table: string, key: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const transaction = Instance.transaction(table);
            transaction.addEventListener("error", (error) => {
                console.error(`Database transaction failed for ${table}`, error);
                reject(error);
            });
            const request = transaction.objectStore(table).getKey(key);
            request.addEventListener("error", (error) => {
                console.error(`Database GET request failed for ${table}["${key}"]`, error);
                reject(error);
            });
            request.addEventListener("success", () => {
                resolve(request.result);
            });
        });
    }

    export async function Insert(tableName: string, object: any) {
        let table = Tables.filter(t => t.name.toLowerCase() == tableName.toLowerCase())[0];
        if (!table) {
            throw new Error(`Invalid table ${tableName}`);
        }
        const col = table.columns[0];
        const key = typeof col === "object" ? col.name : col
        const check = await Get(tableName, object[key]);
        if (check) {
            throw new Error(`Cannot INSERT object ${object[key]}, already exist in ${tableName}`);
        }
        return Set(tableName, object);
    }

    export async function Update(tableName: string, object: any) {
        let table = Tables.filter(t => t.name.toLowerCase() == tableName.toLowerCase())[0];
        if (!table) {
            throw new Error(`Invalid table ${tableName}`);
        }
        const col = table.columns[0];
        const key = typeof col === "object" ? col.name : col
        const check = await Get(tableName, object[key]);
        if (!check) {
            throw new Error(`Cannot UPDATE object ${object[key]}, does not exist in ${tableName}`);
        }
        return Set(tableName, object);
    }

    export async function RawSet(tableName: string, object: any): Promise<void> {
        return new Promise((resolve, reject) => {
            object.dbVersion = CURRENT_VERSION;
            var transaction = Instance.transaction(tableName, "readwrite")
            transaction.addEventListener("error", (error) => {
                console.error(`Database transaction failed for ${tableName}`, error);
                reject(error);
            });

            var request = transaction.objectStore(tableName).put(object);

            request.addEventListener("error", (error) => {
                console.error(`Database SET request failed for ${tableName}`, error);
                reject(error);
            });
            request.addEventListener("success", () => {
                resolve();
            });
        });
    }

    export async function Set(tableName: string, object: any): Promise<void> {
        let table = Tables.filter(t => t.name.toLowerCase() == tableName.toLowerCase())[0];
        if (!table) {
            throw new Error(`Invalid table ${tableName}`);
        }
        for (const key in object) {
            if (object.hasOwnProperty(key)) {
                if (table.columns.filter(col => typeof col === "object" ? col.name == key : col == key).length <= 0) {
                    throw new Error(`Invalid object has extra key ${key}`);
                }
            }
        }
        let stop = false;
        for (let i = 0; i < table.columns.length; i++) {
            const col = table.columns[i];
            const name = typeof col === "object" ? col.name : col;
            const value = object[name];
            if (value === null || value === undefined) {
                if (typeof col === "string" || (typeof col === "object" && !col.nullable)) {
                    throw new Error(`Non-nullable column ${name} is null or undefined`);
                }
                delete object[name];
            }
            if (typeof col === "object" && col.foreignTable) {
                let foreign = await Get(col.foreignTable, value);
                if (!foreign) {
                    throw new Error(`Foreign key ${name} is invalid`)
                }
            }
        }

        return RawSet(table.name, object);
    }
}