// Vue entry — exports the canvas + preview components the host
// runtime plugin loader dynamic-imports as `dist/vue.js`.

import View from "./View.vue";
import Preview from "./Preview.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
  previewComponent: Preview,
};
