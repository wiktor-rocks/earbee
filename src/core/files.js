// File names and types.

export const fileExtension = (name) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

// `videoExtensions` is CONFIG.video.extensions.
export const isVideoFile = (file, videoExtensions) =>
  file.type.startsWith("video/") || videoExtensions.includes(fileExtension(file.name));
