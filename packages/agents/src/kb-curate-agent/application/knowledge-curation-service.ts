import type {
  KnowledgeCurationApplicationService,
  KnowledgeCurationRunResult,
} from "@thoth/contracts";

export class KnowledgeCurationService
  implements KnowledgeCurationApplicationService
{
  public async runOnce(): Promise<KnowledgeCurationRunResult> {
    return {
      status: "idle",
      checkedAt: new Date().toISOString(),
    };
  }
}
