// Segmented-control look shared by the print tabs (links, server-rendered) and the in-page choices
// (radio segments): a neutral pill track (visible on the parchment canvas and on white cards) with a white
// selected segment, every segment a 44px target.
export const SEGMENT_TRACK = "inline-flex max-w-full flex-wrap gap-1 rounded-full bg-foreground/6 p-1";
export const SEGMENT_ITEM =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-4 text-[15px] text-muted-foreground transition-colors hover:text-foreground";
export const SEGMENT_ITEM_ON = "bg-card text-foreground ring-1 ring-border";
