module.exports = {
  "parser": "babel-eslint",
  "env": {
    "browser": true,
    "node": true
  },
  "extends": "eslint:recommended",
  "rules": {
    "consistent-return": 2,
    "dot-location": [2, "property"],
    "no-shadow": [2, {"allow": ["_"]}],
    "no-unused-vars": [2, {"args": "none"}],
    "no-use-before-define": [2, {"functions": false}],
    "semi": [2, "always"]
  }
};
