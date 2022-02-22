import { Logger } from "log4js";

declare global {
    var SHINY_SERVER_VERSION: string;
    var logger: Logger;
}

declare module "q" {
    class Promise<T> {
        eat(): void;
        done(): void;
    }
}