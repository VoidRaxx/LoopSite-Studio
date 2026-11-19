export type Runtime = "php" | "static" | "custom";

export interface ServerConfig {
  id: string;
  name: string;
  rootPath: string;
  port: number;
  runtime: Runtime;
  phpExecutablePath?: string | null;
  routerFile: string | null;
  lanAccess: boolean;
}

export interface DomainRoute {
  id: string;
  hostname: string;
  serverId: string;
  https: boolean;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  servers: ServerConfig[];
  domains: DomainRoute[];
}

export type Theme = "system" | "default" | "universe-dark" | "universe-light" | "dark" | "white" | "ocean-dark" | "forest-dark" | "graphite" | "rose-dark" | "sunset-light" | "arctic-light";
export type UiSize = "compact" | "normal" | "large";
