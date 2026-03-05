export type Channel = "gmail" | "discord" | "web" | "mobile";

export interface Message {
  id: string;
  channel: Channel;
  content: string;
  timestamp: Date;
}
