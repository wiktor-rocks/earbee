// Settings › Downloads: where downloaded files go, and what the From
// YouTube dialog downloads. electron/downloader.js reads them for each
// download; features/download.js starts the dialog on `kind`.
import { defineSection } from "../fields.js";

export const VIDEO_HEIGHTS = [480, 720, 1080, 1440, 2160];

export default defineSection({
  id: "downloads",
  title: "Downloads",
  electronOnly: true,
  fields: [
    {
      key: "folder",
      type: "folder",
      label: "Save downloads in",
      help: "Downloaded songs and videos are saved here, then opened.",
      default: null, // ~/Downloads/TranscriBee (the main process knows where that is)
    },
    {
      key: "kind",
      type: "choice",
      label: "Download",
      help: "What the From YouTube dialog starts on; you can still pick the other there.",
      default: "audio",
      options: [
        { value: "audio", label: "Audio" },
        { value: "video", label: "Video" },
      ],
    },
    {
      key: "maxHeight",
      type: "choice",
      label: "Best video quality",
      help: "Above 1080p, YouTube's videos are VP9 or AV1, which take more of the computer to play.",
      default: 1080,
      options: VIDEO_HEIGHTS.map((height) => ({ value: height, label: `${height}p` })),
    },
  ],
});
