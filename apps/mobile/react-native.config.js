const path = require("node:path");

module.exports = {
  dependencies: {
    expo: {
      root: path.resolve(__dirname, "node_modules/expo"),
      platforms: {
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
          packageInstance: "new ExpoModulesPackage()",
        },
      },
    },
  },
};
