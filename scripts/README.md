# JavaScript CI helpers

These scripts can be found in `node_modules/launchdarkly-js-test-helpers/scripts` after running `npm install` in a project that uses this package.

## better-audit.sh

LaunchDarkly JavaScript projects should run this script as part of their regular CI build/test job. It runs `npm audit` to check for vulnerable dependencies, post-processes the results to be more readable, and exits with an error if there are any vulnerable _runtime_ dependencies.
