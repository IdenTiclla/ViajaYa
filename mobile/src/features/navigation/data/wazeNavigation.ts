import { Linking } from 'react-native';
import { wazeLinks, type NavigationTarget } from '../domain/navigationTarget';

export async function openWaze(target: NavigationTarget) {
  const links = wazeLinks(target);
  const installed = await Linking.canOpenURL(links.app).catch(() => false);
  await Linking.openURL(installed ? links.app : links.web);
}
