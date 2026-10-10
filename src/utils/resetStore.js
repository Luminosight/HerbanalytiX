let resetCallback = null;

export const setResetCallback = (fn) => {
  resetCallback = fn;
};

export const triggerReset = () => {
  if (resetCallback) resetCallback();
};