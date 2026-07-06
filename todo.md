## Goals - [Career - Building great agent UX] - Thoth 2.

## Next Steps
### Thoth 2
- Move graph attributes into a different table - Simplify the design!!
  - Think about support for miscellaneous messages like compactions, model changes etc.
    - [x] Let the client shape the inbound message when requesting completion.
    - [ ] Change ids to numbers instead of a GUID?
- Run an experiment to build a world model for Thoth in a logic program (or somthing similar) and try using it to specify a development goal.
- Try out time measurement using a tool call instead of prompt tuning.
- Check CF models + Chinese models on OpenRouter for faster completions.
- Build a better UI.
    - Complete React Tutorial.
    - Complete React Native tutorial.
    - Learn some basic graphic design.
        - Complete [UI Design Bootcamp. Master Typography, Colour & Grids](https://www.udemy.com/course/ui-design-bootcamp-master-typography-colour-grids/).
        - Review [Design Arena leaderboard](https://www.designarena.ai/leaderboard) for UI design agent benchmarks.
    - Resdesign the UI to make it appealing.
- Tech Debt
  - Improve logging (Add structured logs).
  - Try implementing PKCE + local UI launch.
  - Figure out a way around repeated signing, defaulting to base64?
    - Document store API exposed via a tool call (Some context is lost; But I think it is an acceptable compromise.)
  - Cloudflare-hosted inference, Workers AI / AI Gateway:
    - Explore CF agents as an inference option to reduce completion time.

### Future versions.
- User management.
- Pushing Thoth in the direction of being an everything app along the Talking forms route.
  - Document vault and memories.
  - Automatic research and knowledge synthesis plus continual learning.
  - A reader with LLM overlay.
  - Live video, audio and screenshare input.
  - Integrated calendar view.
  - Web search.
- Model picker.
- Deeplink content support.
- Add support for overlay mode and video/audio inputs.
- Context compaction support.

