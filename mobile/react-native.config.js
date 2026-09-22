/** Keep the Android navigation rollout separate from the existing iOS Maps pods. */
module.exports = { dependencies: { '@googlemaps/react-native-navigation-sdk': { platforms: { ios: null } } } };
