exports.autoScroll = async function autoScroll(page) {
  console.log("Starting targeted auto-scroll...");
  await page.evaluate(async () => {
    const scrollContainer = document.getElementById("scrollableChildren");
    if (!scrollContainer) return;

    await new Promise((resolve) => {
      let distance = 500;
      let lastScrollTop = 0;
      let sameHeightCounter = 0;
      const maxSameTries = 5;

      const timer = setInterval(() => {
        scrollContainer.scrollBy(0, distance);
        const currentScrollTop = scrollContainer.scrollTop;

        if (currentScrollTop === lastScrollTop) {
          sameHeightCounter++;
          if (sameHeightCounter >= maxSameTries) {
            clearInterval(timer);
            resolve();
          }
        } else {
          sameHeightCounter = 0;
          lastScrollTop = currentScrollTop;
        }
      }, 500);
    });
  });
};
exports.delay = (ms) => new Promise((res) => setTimeout(res, ms));