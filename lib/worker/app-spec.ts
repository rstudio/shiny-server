/*
 * app-spec.js
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

export class AppSpec {
  appDir: string;
  runAs: string | ReadonlyArray<string> | undefined;
  prefix: string;
  logDir: string;
  settings: AppSettings;
  logAsUser: boolean;

  constructor(appDir: string, runAs: string | ReadonlyArray<string> | undefined, prefix: string, logDir: string, settings: AppSettings) {
    this.appDir = appDir;
    this.runAs = runAs;
    this.prefix = prefix;
    this.logDir = logDir;
    this.settings = settings;
  }

  getKey() {
    return this.appDir + "\n" +
      this.runAs + "\n" +
      this.prefix + "\n" +
      this.logDir + "\n" +
      JSON.stringify(this.settings);
  };
}

export interface AppSettings {
  templateDir: string;
  restart?: number;
  mode: "shiny" | "rmd";
  scheduler: any;
  logAsUser: boolean;
  gaTrackingId?: string;

  appDefaults: AppDefaults;
}

export interface AppDefaults {
  initTimeout: number;
  idleTimeout: number;
  preserveLogs: boolean;
  reconnect: boolean;
  sanitizeErrors: boolean;
  disableProtocols: Array<string>;
  bookmarkStateDir: string;
  logFileMode: string;
  frameOptions?: string;
}
