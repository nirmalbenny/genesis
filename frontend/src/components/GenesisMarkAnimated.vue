<!-- Genesis's mark, animated as the preview's loader: the coral G draws itself, the network grows out of its bar
     node by node, holds, then fades and starts again (3.6 s, eased throughout so it reads as one smooth motion). With reduced motion the mark
     stays drawn and only breathes. Same drawing as GenesisMark.vue; decorative (the overlay's text says what happens). -->
<template>
  <svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="8" fill="#213343" />
    <g class="art" transform="translate(16 16) scale(1.15) translate(-16 -16)">
      <path class="g" pathLength="100" d="M22.4 9.6A9 9 0 1 0 25 16h-6.6" fill="none" stroke="#ff7a59" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
      <path class="link l1" pathLength="100" d="M18.4 16 14.4 11.9 10.9 15.1" fill="none" stroke="#f6e9da" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      <path class="link l2" pathLength="100" d="M18.4 16 13.8 20.3" fill="none" stroke="#f6e9da" stroke-width="1.2" stroke-linecap="round" />
      <circle class="node n1" cx="18.4" cy="16" r="2" fill="#f6e9da" />
      <circle class="node n2" cx="14.4" cy="11.9" r="1.6" fill="#f6e9da" />
      <circle class="node n3" cx="10.9" cy="15.1" r="1.4" fill="#f6e9da" />
      <circle class="node n4" cx="13.8" cy="20.3" r="1.6" fill="#f6e9da" />
    </g>
  </svg>
</template>

<style scoped>
/* One 3.6 s clock for every part (no animation-delay, so nothing drifts out of step with the fade), all eased:
   0-40% the G draws; 30-58% the links grow from its bar; 32-62% the nodes fade and grow in, one after another;
   hold; 78-96% everything fades out. */
.art { animation: fade 3.6s ease-in-out infinite; }
.g { stroke-dasharray: 100; animation: draw-g 3.6s cubic-bezier(0.45, 0, 0.25, 1) infinite; }
.link { stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0; } /* hidden until drawn: a round cap paints a dot at length 0 */
.l1 { animation: draw-l1 3.6s ease-in-out infinite; }
.l2 { animation: draw-l2 3.6s ease-in-out infinite; }
.node { transform-box: fill-box; transform-origin: center; transform: scale(0.4); opacity: 0; }
.n1 { animation: node-1 3.6s ease-out infinite; }
.n2 { animation: node-2 3.6s ease-out infinite; }
.n3 { animation: node-3 3.6s ease-out infinite; }
.n4 { animation: node-4 3.6s ease-out infinite; }

@keyframes draw-g { 0% { stroke-dashoffset: 100; } 40%, 100% { stroke-dashoffset: 0; } }
@keyframes draw-l1 { 0%, 30% { stroke-dashoffset: 100; opacity: 0; } 33% { opacity: 1; } 54%, 100% { stroke-dashoffset: 0; opacity: 1; } }
@keyframes draw-l2 { 0%, 34% { stroke-dashoffset: 100; opacity: 0; } 37% { opacity: 1; } 58%, 100% { stroke-dashoffset: 0; opacity: 1; } }
@keyframes node-1 { 0%, 32% { opacity: 0; transform: scale(0.4); } 42%, 100% { opacity: 1; transform: scale(1); } }
@keyframes node-2 { 0%, 42% { opacity: 0; transform: scale(0.4); } 52%, 100% { opacity: 1; transform: scale(1); } }
@keyframes node-3 { 0%, 52% { opacity: 0; transform: scale(0.4); } 62%, 100% { opacity: 1; transform: scale(1); } }
@keyframes node-4 { 0%, 47% { opacity: 0; transform: scale(0.4); } 57%, 100% { opacity: 1; transform: scale(1); } }
@keyframes fade { 0%, 78% { opacity: 1; } 96%, 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .g, .link, .node { animation: none; stroke-dashoffset: 0; opacity: 1; transform: none; }
  .art { animation: breathe 2.4s ease-in-out infinite; }
}
@keyframes breathe { 50% { opacity: 0.55; } }
</style>
