# LaunchDarkly JavaScript Test Helpers

[![Circle CI](https://circleci.com/gh/launchdarkly/js-test-helpers/tree/master.svg?style=svg)](https://circleci.com/gh/launchdarkly/js-test-helpers/tree/master)

This package centralizes some test support code that is used by LaunchDarkly's JavaScript-based SDKs (browser, Node, Electron, etc.) and that may be useful in other JS projects. It can be used to test any kind of JavaScript code as long as the tests themselves are run in Node (version 6 or higher).

While this code may be useful in other projects, it is primarily geared toward LaunchDarkly's own development needs and is not meant to provide a large general-purpose framework. It is meant for unit test code and should not be used as a runtime dependency.

The module is implemented in TypeScript, but can be used without TypeScript. See the [API documentation](https://launchdarkly.github.io/js-test-helpers/) for a description of the functions, parameters, and types in TypeScript syntax.

## Usage

In TypeScript or ES6 code:

```JS
import { TestHttpServer, promisify } from "launchdarkly-js-test-helpers";
```

In regular Node.js code:

```JS
const { TestHttpServer, promisify } = require("launchdarkly-js-test-helpers");
```

## Build helpers

The `scripts` directory contains tools that can be helpful in CI; see [`scripts/README.md`](scripts/README.md).

## Contributing

We encourage pull requests and other contributions from the community. Check out our [contributing guidelines](CONTRIBUTING.md) for instructions on how to contribute to this SDK.

## About LaunchDarkly

* LaunchDarkly is a continuous delivery platform that provides feature flags as a service and allows developers to iterate quickly and safely. We allow you to easily flag your features and manage them from the LaunchDarkly dashboard.  With LaunchDarkly, you can:
    * Roll out a new feature to a subset of your users (like a group of users who opt-in to a beta tester group), gathering feedback and bug reports from real-world use cases.
    * Gradually roll out a feature to an increasing percentage of users, and track the effect that the feature has on key metrics (for instance, how likely is a user to complete a purchase if they have feature A versus feature B?).
    * Turn off a feature that you realize is causing performance problems in production, without needing to re-deploy, or even restart the application with a changed configuration file.
    * Grant access to certain features based on user attributes, like payment plan (eg: users on the ‘gold’ plan get access to more features than users in the ‘silver’ plan). Disable parts of your application to facilitate maintenance, without taking everything offline.
* LaunchDarkly provides feature flag SDKs for a wide variety of languages and technologies. Check out [our documentation](https://docs.launchdarkly.com/docs) for a complete list.
* Explore LaunchDarkly
    * [launchdarkly.com](https://www.launchdarkly.com/ "LaunchDarkly Main Website") for more information
    * [docs.launchdarkly.com](https://docs.launchdarkly.com/  "LaunchDarkly Documentation") for our documentation and SDK reference guides
    * [apidocs.launchdarkly.com](https://apidocs.launchdarkly.com/  "LaunchDarkly API Documentation") for our API documentation
    * [blog.launchdarkly.com](https://blog.launchdarkly.com/  "LaunchDarkly Blog Documentation") for the latest product updates
    * [Feature Flagging Guide](https://github.com/launchdarkly/featureflags/  "Feature Flagging Guide") for best practices and strategies
