export interface KnowledgeCurationRunResult {
  status: "idle";
  checkedAt: string;
}

export interface KnowledgeCurationApplicationService {
  runOnce(): Promise<KnowledgeCurationRunResult>;
}
