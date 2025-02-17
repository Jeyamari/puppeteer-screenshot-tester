const resemble = require('nodejs-resemble');
const fs = require('fs');
const parentModule = require('parent-module');
const path = require('path');
const sharp = require('sharp');

const DEFAULT_COMPRESSION = 85;
const DEFAULT_PNG_COMPRESSION = 8;

// currying everywhere, that allows us to create one setup and then use tester without copying config each time
const ScreenTestFactory = function(
  threshold = 0,
  includeAA = false,
  ignoreColors = false,
  matchingBox = {
    ignoreRectangles: [],
    includeRectangles: []
  },
  errorSettings = {
    errorColor: {
      red: 255,
      green: 0,
      blue: 255
    },
    errorType: 'flat',
    transparency: 0.7
  },
  outputSettings = {
    forceExt: null,
    compressionLevel: null
  }) {
  if(Array.isArray(matchingBox)) {
    console.error(`You're using old version of API, please refer to https://github.com/burnpiro/puppeteer-screenshot-tester/releases/tag/1.3.0`);
    matchingBox = {
      ignoreRectangles: matchingBox,
      includeRectangles: []
    }
  }
  resemble.outputSettings(errorSettings);
  // get path to called directory
  // cannot use __directory because it returns module directory instead of caller
  const folderPath = path.dirname(parentModule());
  return new Promise( resolve => {
    resolve(async (page, name = 'test', screenshotOptions = {}) => {
      let saveFolder = folderPath;
      let ext = screenshotOptions.type ? `.${screenshotOptions.type}` : '.png';
      if(screenshotOptions.path != null) {
        const puppeteerExt = path.extname(screenshotOptions.path);
        const puppeteerPath = path.dirname(screenshotOptions.path);
        const puppeteerFileName = path.basename(screenshotOptions.path, puppeteerExt);

        if(typeof puppeteerFileName === 'string' && puppeteerFileName.length > 0 && typeof puppeteerPath === 'string' && puppeteerPath.length > 0) {
          saveFolder = puppeteerPath;
          name = puppeteerFileName;
          ext = puppeteerExt || '.png';
        }
        delete screenshotOptions.path;
      }
      // get existing image, might return undefined
      const oldImage = await getOldImageData(saveFolder, name, ext);

      // get page object from puppeteer and create screenshot without path to receive Buffer
      const screenShot = await page.screenshot(screenshotOptions);
      if (oldImage !== undefined) {
        // call comparison between images
        const comparisonResult = resemble(screenShot)
          .compareTo(oldImage);

        // Add extra options if specified
        if (!includeAA) {
          comparisonResult.ignoreAntialiasing()
        }
        if (ignoreColors) {
          comparisonResult.ignoreColors()
        }
        if (Array.isArray(matchingBox.ignoreRectangles) && matchingBox.ignoreRectangles.length > 0) {
          comparisonResult.ignoreRectangles(matchingBox.ignoreRectangles)
        }
        if (Array.isArray(matchingBox.includeRectangles) && matchingBox.includeRectangles.length > 0) {
          comparisonResult.includeRectangles(matchingBox.includeRectangles)
        }

        // await for a comparison to be completed and return resolved value
        return await new Promise(resolve => {
          comparisonResult.onComplete((data) => {
              // check if images are the same dimensions and mismatched pixels are below threshold
              if (data.isSameDimensions === false || Number(data.misMatchPercentage) > threshold) {
                // save diff to test folder with '-diff' postfix
                const storeExt = outputSettings.forceExt != null ? outputSettings.forceExt : ext.substring(ext.lastIndexOf(".")+1);
                const extFormatter = {
                  'jpeg': () => sharp().jpeg({ quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION }),
                  'jpg': () => sharp().jpeg({ quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION }),
                  'png': () => sharp().png({ compressionLevel: outputSettings.compressionLevel | DEFAULT_PNG_COMPRESSION }),
                  'webp': () => sharp().webp({ quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION })
                }
                data.getDiffImage().pack()
                  .pipe(extFormatter[storeExt]())
                  .pipe(fs.createWriteStream(`${saveFolder}/${name}-diff${ext}`));

                // optionally save the new image to the test directory
                if (screenshotOptions.saveNewImageOnError || screenshotOptions.overwriteImageOnChange) {
                  const newFilePath = screenshotOptions.overwriteImageOnChange ? `${saveFolder}/${name}${ext}` : `${saveFolder}/${name}-new${ext}`;
                  switch (storeExt) {
                    case 'jpeg':
                    case 'jpg':
                      sharp(screenShot)
                        .jpeg({quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION})
                        .toFile(newFilePath);
                      break;
                    case 'webp':
                      sharp(screenShot)
                        .webp({quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION})
                        .toFile(newFilePath);
                      break;
                    default:
                      sharp(screenShot)
                        .png({quality: outputSettings.compressionLevel || DEFAULT_PNG_COMPRESSION})
                        .toFile(newFilePath);
                  }
                }


                resolve(false)
              } else {
                resolve(true)
              }
            });
        });
      } else {
        // if there is no old image we cannot compare two images so just write existing screenshot as default image
        // fs.writeFileSync(`${saveFolder}/${name}${ext}`, screenShot);
        const storeExt = outputSettings.forceExt != null ? outputSettings.forceExt : ext.substring(ext.lastIndexOf(".")+1);
        switch (storeExt) {
          case 'jpeg':
          case 'jpg':
            await sharp(screenShot)
              .jpeg({ quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION })
              .toFile(`${saveFolder}/${name}${ext}`);
            break;
          case 'webp':
            await sharp(screenShot)
              .webp({ quality: outputSettings.compressionLevel || DEFAULT_COMPRESSION })
              .toFile(`${saveFolder}/${name}${ext}`);
            break;
          default:
            await sharp(screenShot)
              .png({ quality: outputSettings.compressionLevel || DEFAULT_PNG_COMPRESSION })
              .toFile(`${saveFolder}/${name}${ext}`);
        }
        console.log('There was nothing to compare, current screens saved as default');
        return true;
      }
    })
  })
}

// returns promise which resolves with undefined or PNG object
const getOldImageData = function(folderPath, name = 'test', ext = 'png') {
  return new Promise((resolve) => {
    fs.stat(`${folderPath}/${name}${ext}`, (error) => {
      if (error) {
        // if there is an error resolve with undefined
        resolve();
      } else {
        // if file exists just get file and pipe it into PNG
        fs.readFile(`${folderPath}/${name}${ext}`, (err, data) => {
          if (err || !data instanceof Buffer) {
            resolve();
          } else {
            resolve(data);
          }
        })
      }
    })
  })
}

module.exports = ScreenTestFactory
