import type {
  GenerateResponseInput,
  GenerateResponseOutput,
  LlmServicePort,
} from "@thoth/contracts";

export class GenerateResponseService {
  constructor(private readonly llmService: LlmServicePort) {}

  async execute(
    input: GenerateResponseInput,
  ): Promise<GenerateResponseOutput> {
    return this.llmService.generateResponse(input);
  }
}
