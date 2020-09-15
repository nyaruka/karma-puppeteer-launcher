var path = require("path");
var puppeteer = require("puppeteer-core");
var fs = require("fs");
var DEFAULT_CMD = require("./chrome");
var PNG = require("pngjs").PNG;
var pixelmatch = require("pixelmatch");
var dynamicpixelmatch = require("dynamicpixelmatch");

function isJSFlags(flag) {
  return flag.indexOf("--js-flags=") === 0;
}

function sanitizeJSFlags(flag) {
  var test = /--js-flags=(['"])/.exec(flag);
  if (!test) {
    return flag;
  }
  var escapeChar = test[1];
  var endExp = new RegExp(escapeChar + "$");
  var startExp = new RegExp("--js-flags=" + escapeChar);
  return flag.replace(startExp, "--js-flags=").replace(endExp, "");
}

var ChromeBrowser = function (baseBrowserDecorator, args) {
  baseBrowserDecorator(this);

  var flags = args.flags || [];
  var userDataDir = args.chromeDataDir || this._tempDir;

  this._getOptions = function (url) {
    // Chrome CLI options
    // http://peter.sh/experiments/chromium-command-line-switches/
    flags.forEach(function (flag, i) {
      if (isJSFlags(flag)) {
        flags[i] = sanitizeJSFlags(flag);
      }
    });

    return [
      "--user-data-dir=" + userDataDir,
      "--no-default-browser-check",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--disable-translate",
      "--disable-background-timer-throttling",
    ].concat(flags, [url]);
  };
};

const ensureExists = function (path, mask) {
  return new Promise((resolve, reject) => {
    if (typeof mask == "function") {
      // allow the `mask` parameter to be optional
      //cb = mask;
      mask = 0777;
    }
    fs.mkdir(path, mask, function (err) {
      if (err) {
        if (err.code == "EEXIST")
          resolve("ignore the error if the folder already exists");
        else reject(err); // something else went wrong
      }
      resolve("file created successfully with handcrafted Promise!");
    });
  });
};
const ensureExistsFromRoot = async (root, paths) => {
  var rootPath = root;
  await ensureExists(rootPath);
  for (var i = 0; i < paths.length - 1; i++) {
    rootPath = path.resolve(rootPath, paths[i]);
    await ensureExists(rootPath);
  }
};
const fileExists = (path) => {
  return new Promise((resolve, reject) => {
    fs.access(path, fs.F_OK, (err) => {
      if (err) {
        resolve(false);
      }
      resolve(true);
    });
  });
};
const DEFAULT_TARGET_DIR = "target";
const DEFAULT_SCREENSHOT_GOLDEN_DIR = "golden";
const DEFAULT_SCREENSHOT_DIR = "screenshots";
const DEFAULT_SCREENSHOT_DIFF_DIR = "diff";

const screenshotRootpaths = ["./", DEFAULT_TARGET_DIR, DEFAULT_SCREENSHOT_DIR];
const goldenRootpaths = [
  "./",
  DEFAULT_TARGET_DIR,
  DEFAULT_SCREENSHOT_GOLDEN_DIR,
];
const diffRootpaths = ["./", DEFAULT_TARGET_DIR, DEFAULT_SCREENSHOT_DIFF_DIR];

const getGoldenScreenshotPath = (paths) =>
  path.resolve(...goldenRootpaths.concat(paths));
const getScrenshotPath = (paths) =>
  path.resolve(...screenshotRootpaths.concat(paths));
const getDiffScrenshotPath = (paths) =>
  path.resolve(...diffRootpaths.concat(paths));

const compareScreenshots = async (paths, exluded) => {
  return new Promise(async (resolve, reject) => {
    doneReading = async () => {
      // Wait until both files are read.
      if (++filesRead < 2) return;

      // The files should be the same size.

      if (img1.width != img2.width) {
        console.error("image widths are not the same");
        resolve(false);
      }
      if (img1.height != img2.height) {
        console.error("image heights are not the same");
        resolve(false);
      }

      // Do the visual diff.
      const diff = new PNG({ width: img1.width, height: img2.height });
      const matchOptions = { threshold: 0.2 };
      const numDiffPixels =
        exluded != null && exluded.length != 0
          ? dynamicpixelmatch(
              img1.data,
              img2.data,
              diff.data,
              img1.width,
              img1.height,
              matchOptions,
              exluded
            )
          : pixelmatch(
              img1.data,
              img2.data,
              diff.data,
              img1.width,
              img1.height,
              matchOptions
            );

      // The files should look the same.
      if (numDiffPixels != 0) {
        console.error("number of different pixels are not 0");

        await ensureExistsFromRoot(path.resolve(...diffRootpaths), paths);
        diff.pack().pipe(fs.createWriteStream(getDiffScrenshotPath(paths)));

        resolve(false);
      }
      resolve(true);
    };
    const img1 = fs
      .createReadStream(getGoldenScreenshotPath(paths))
      .pipe(new PNG())
      .on("parsed", await doneReading);
    const img2 = fs
      .createReadStream(getScrenshotPath(paths))
      .pipe(new PNG())
      .on("parsed", await doneReading);

    let filesRead = 0;
  });
};
var PuppeteerBrowser = function (baseBrowserDecorator, args) {
  ChromeBrowser.apply(this, arguments);
  // console.log(args);

  var flags = args.flags || [];

  var browser;
  this._start = async (url) => {
    // console.log(url);
    await ensureExists(path.resolve("./", DEFAULT_TARGET_DIR));
    await ensureExists(
      path.resolve("./", DEFAULT_TARGET_DIR, DEFAULT_SCREENSHOT_DIR)
    );

    browser = await puppeteer.launch({
      headless: flags.indexOf("--headless") != -1,
      args: flags,
      executablePath: DEFAULT_CMD[process.platform],
    });
    const page = await browser.newPage();

    // Capture logging
    // page.on('console', (...args) => console.log.apply(console, ['[Browser]', ...args]));

    // Expose Screenshot function
    await page.exposeFunction("capturePage", (name, clip) => {
      const filename = path.resolve(
        "./",
        DEFAULT_TARGET_DIR,
        DEFAULT_SCREENSHOT_DIR,
        `${name}.png`
      );
      // console.log("[Node]", "Save 🎨  to", filename);
      return page.screenshot(
        clip !== undefined
          ? { path: filename, clip: clip }
          : { path: filename, fullPage: true }
      );
    });

    await page.exposeFunction("puppeteerDone", async (code) => {
      await browser.close();
      process.exit(code);
    });

    await page.exposeFunction("setViewport", async (options) => {
      await page.setViewport(options);
    });
    await page.exposeFunction("captureElement", async (name, selector) => {
      const filename = path.resolve(
        "./",
        DEFAULT_TARGET_DIR,
        DEFAULT_SCREENSHOT_DIR,
        `${name}.png`
      );
      const frame = await page.frames().find((f) => f.name() === "context");
      const element = await frame.$(selector);
      await element.screenshot({ path: filename });
    });

    const screenshotPage = async (paths, golden, clip) => {
      await ensureExistsFromRoot(
        golden
          ? path.resolve(...goldenRootpaths)
          : path.resolve(...screenshotRootpaths),
        paths
      );
      const filename = golden
        ? getGoldenScreenshotPath(paths)
        : getScrenshotPath(paths);
      // console.log("[Node]", "Save 🎨  to", filename);
      return page.screenshot(
        clip !== undefined
          ? { path: filename, clip: clip }
          : { path: filename, fullPage: true }
      );
    };
    const screenshotElement = async (paths, selector, golden) => {
      await ensureExistsFromRoot(
        golden
          ? path.resolve(...goldenRootpaths)
          : path.resolve(...screenshotRootpaths),
        paths
      );
      const filename = golden
        ? getGoldenScreenshotPath(paths)
        : getScrenshotPath(paths);
      const frame = await page.frames().find((f) => f.name() === "context");
      const element = await frame.$(selector);
      await element.screenshot({ path: filename });
    };

    await page.exposeFunction("matchPageSnapshot", (paths, clip, exluded) => {
      return new Promise(async (resolve, reject) => {
        var update = flags.indexOf("--snapshot-update") != -1;
        if (update) {
          await screenshotPage(paths, true, clip);
          resolve(true);
        } else {
          const snapshotExists = await fileExists(
            getGoldenScreenshotPath(paths)
          );
          if (!snapshotExists) {
            await screenshotPage(paths, true, clip);
            resolve(true);
          } else {
            await screenshotPage(paths, false, clip);
            resolve(await compareScreenshots(paths, exluded));
          }
        }
      });
    });
    await page.exposeFunction(
      "matchElementSnapshot",
      (paths, selector, excluded) => {
        return new Promise(async (resolve, reject) => {
          var update = flags.indexOf("--snapshot-update") != -1;
          if (update) {
            await screenshotElement(paths, selector, true);
            resolve(true);
          } else {
            const snapshotExists = await fileExists(
              getGoldenScreenshotPath(paths)
            );
            if (!snapshotExists) {
              await screenshotElement(paths, selector, true);
              resolve(true);
            } else {
              await screenshotElement(paths, selector, false);
              resolve(await compareScreenshots(paths, excluded));
            }
          }
        });
      }
    );

    await page.goto(url);
  };

  this.on("kill", async (done) => {
    if (browser != null) {
      // console.log("Closing puppeteer browser.");
      await browser.close();
    }
    done();
  });
};

PuppeteerBrowser.prototype = {
  name: "Puppeteer",
  DEFAULT_CMD: {},
  ENV_CMD: "PUPPETEER_BIN",
};

PuppeteerBrowser.$inject = ["baseBrowserDecorator", "args"];

// PUBLISH DI MODULE
module.exports = {
  "launcher:Puppeteer": ["type", PuppeteerBrowser],
};
