export interface DatabaseHealthCheck { ping(): Promise<void>; }
