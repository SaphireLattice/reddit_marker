namespace Marker.Database {

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
        primaryKeys?: string[];
    }

    export class Instance {
        public versionCurrent: number;
        private versionPrevious: number = this.versionCurrent;

        public database: IDBDatabase | null = null;
        // FK targets and who they come from
        // TODO: make this work with migrations?
        private foreignKeys: Map<string, string[]> = new Map();
        private promise: Promise<Instance>;

        // Migrations migrate from version [n] to CURRENT
        // Do NOT make them migrate from [n] to [n+1] to ... to CURRENT

        constructor(name: string, version: number, public tables: TableDefinition[], public migrations: Migration[] = []) {
            let resolve: (result: Instance) => void;
            let reject: (reason: any) => void;
            this.promise = new Promise<Instance>((resolvePromise, rejectPromise) => {
                resolve = resolvePromise;
                reject = rejectPromise;
            })
            this.versionCurrent = version;
            var request = window.indexedDB.open(name, this.versionCurrent);
            request.addEventListener("success", (e: any) => {this.success(e); resolve(this)});
            request.addEventListener("upgradeneeded", (e: any) =>  this.upgradeNeeded(e));
            request.addEventListener("error", (a: any) => {this.failure(a); reject(a)});
        }

        public init(): Promise<Instance> {
            return this.promise;
        }

        public failure(error: any) {
            console.error("Database access request failed. No recovery possible.", error);
        }

        public success(event: any) {
            this.database = event.target.result;
            if (!this.database) {
                throw new Error("Unable to store database reference");
            }
            if (this.versionPrevious == this.versionCurrent || !this.migrations[this.versionPrevious]) {
                console.log("Database opened successfully")
                return;
            } else {
                this.migrations[this.versionPrevious].migrate(event);
            }
        }

        public upgradeNeeded(event: any) {
            this.database = <IDBDatabase> event.target.result;
            let migration: Migration = this.migrations[event.oldVersion];
            if (migration && migration.upgrade != null) {
                migration.upgrade(event);
            } else {
                this.tables.forEach(table => {
                    var objectStore = null;
                    if (table.version > event.oldVersion) {
                        const firstCol = table.columns[0];
                        objectStore = this.database!.createObjectStore(table.name,
                            {
                                keyPath: table.primaryKeys ?
                                    table.primaryKeys :
                                    typeof firstCol === "object" ? firstCol.name : firstCol
                            }
                        );
                    } else {
                        objectStore = event.target.transaction.objectStore(table.name);
                    }

                    for (let index = 0; index < table.columns.length; index++) {
                        const column = table.columns[index];
                        if ((typeof column === "object" ? column.version : table.version) > event.oldVersion) {
                            if (typeof column === "object") {
                                    objectStore.createIndex(column.name, column.name, {
                                        unique: column.unique == true,
                                        multiEntry: column.multiEntry == true
                                    });
                            } else {
                                objectStore.createIndex(column, column);
                            }
                        }
                    }
                });
            }
            this.versionPrevious = event.oldVersion;
        }

        async get<Type>(table: string, key: string | number | IDBKeyRange): Promise<Type | undefined> {
            return await new Promise((resolve, reject) => {
                const transaction = this.database!.transaction(table, "readonly");
                transaction.addEventListener("error", (error) => {
                    console.error(`Database transaction failed for ${table}`, error);
                    reject(error);
                });
                const request = transaction.objectStore(table).get(key);
                request.addEventListener("error", (error) => {
                    console.error(`Database GET request failed for ${table}["${key}"]`, error);
                    reject(error);
                });
                request.addEventListener("success", () => {
                    resolve(<any> request.result);
                });
            });
        }

        async getList<Type>(table: string, value?: string | IDBKeyRange, column: string | null = null): Promise<Type[]> {
            return await new Promise((resolve, reject) => {
                const transaction = this.database!.transaction(table, "readonly");
                transaction.addEventListener("error", (error) => {
                    console.error(`Database transaction failed for ${table}`, error);
                    reject(error);
                });
                let request: IDBRequest<IDBCursorWithValue | null>;
                if (column)
                    request = transaction.objectStore(table).index(column).openCursor(value);
                else
                    request = transaction.objectStore(table).openCursor(value);

                request.addEventListener("error", (error) => {
                    console.error(`Database GETLIST request failed for ${table}["${value}"]`, error);
                    reject(error);
                });
                const list: Type[] = [];
                request.addEventListener("success", (event) => {
                    let cursor: IDBCursorWithValue = (<any> event.target!).result;
                    if (cursor) {
                        list.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(list);
                    }
                });
            });
        }

        public async insert(tableName: string, object: any) {
            let table = this.tables.filter(t => t.name.toLowerCase() == tableName.toLowerCase())[0];
            if (!table) {
                throw new Error(`Invalid table ${tableName}`);
            }
            const col = table.columns[0];
            const key = typeof col === "object" ? col.name : col
            const check = await this.get(tableName, object[key]);
            if (check) {
                throw new Error(`Cannot INSERT object ${object[key]}, already exist in ${tableName}`);
            }
            return await this.set(tableName, object);
        }

        public async update(tableName: string, object: any) {
            let table = this.tables.filter(t => t.name.toLowerCase() == tableName.toLowerCase())[0];
            if (!table) {
                throw new Error(`Invalid table ${tableName}`);
            }
            const col = table.columns[0];
            const key = typeof col === "object" ? col.name : col
            const check = await this.get(tableName, object[key]);
            if (!check) {
                throw new Error(`Cannot UPDATE object ${object[key]}, does not exist in ${tableName}`);
            }
            return await this.set(tableName, object);
        }

        private async rawSet(tableName: string, object: any): Promise<void> {
            return await new Promise((resolve, reject) => {
                object.dbVersion = this.versionCurrent;
                var transaction = this.database!.transaction(tableName, "readwrite")
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

        public async set<Type>(tableName: string, object: Type): Promise<void> {
            let table = this.tables.filter(t => t.name.toLowerCase() == tableName.toLowerCase())[0];
            if (!table) {
                throw new Error(`Invalid table ${tableName}`);
            }
            for (const key in object) {
                if ((<any> object).hasOwnProperty(key)) {
                    if (key != "dbVersion" && table.columns.filter(col => typeof col === "object" ? col.name == key : col == key).length <= 0) {
                        throw new Error(`Invalid object has extra key ${key}`);
                    }
                }
            }
            let stop = false;
            for (let i = 0; i < table.columns.length; i++) {
                const col = table.columns[i];
                const name = typeof col === "object" ? col.name : col;
                const value = (<any> object)[name];
                if (value === null || value === undefined) {
                    if (typeof col === "string" || (typeof col === "object" && !col.nullable)) {
                        throw new Error(`Non-nullable column ${name} is null or undefined`);
                    }
                    delete (<any> object)[name];
                    continue;
                }
                if (typeof col === "object" && col.foreignTable) {
                    let foreign = await this.get(col.foreignTable, value);
                    if (!foreign) {
                        throw new Error(`Foreign key ${name} is invalid`)
                    }
                }
            }

            return await this.rawSet(table.name, object);
        }

        public async delete(tableName: string, value: number | string | IDBKeyRange, column?: string) {
            return await new Promise((resolve, reject) => {
                var transaction = this.database!.transaction(tableName, "readwrite")
                transaction.addEventListener("error", (error) => {
                    console.error(`Database transaction failed for ${tableName}`, error);
                    reject(error);
                });

                let request: IDBRequest<IDBCursorWithValue | null>;
                if (column)
                    request = transaction.objectStore(tableName).index(column).openCursor(value);
                else
                    request = transaction.objectStore(tableName).openCursor(value);

                request.addEventListener("error", (error) => {
                    console.error(`Database GETLIST request failed for ${tableName}["${value}"]`, error);
                    reject(error);
                });
                request.addEventListener("success", (event) => {
                    let cursor: IDBCursorWithValue = (<any> event.target!).result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        resolve();
                    }
                });
            });
        }
    }
}