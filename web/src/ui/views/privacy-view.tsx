// SPDX-License-Identifier: GPL-3.0-or-later

import { Card, CardTitle } from "../components/card";

const link = "inline-flex min-h-11 items-center font-medium text-primary underline";

export function PrivacyView() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <Card aria-labelledby="privacy-data">
        <CardTitle id="privacy-data">Your information stays with you</CardTitle>
        <ul className="list-disc space-y-2 pl-5 text-base">
          <li>This app sends nothing to any server on the internet. It has no analytics, no tracking and no ads.</li>
          <li>
            The app asks for nothing but its own files and your Zenit. It uses no fonts, scripts or images from other
            sites.
          </li>
          <li>
            It connects only to a Zenit on your own network, or to this computer: an address on the internet is refused.
          </li>
          <li>Your settings and your Zenit's details travel only between this page and your Zenit.</li>
          <li>
            The browser keeps two things on this device: your theme choice, and the last address you connected to.
          </li>
          <li>
            Your WiFi password goes from this page to your Zenit over the USB cable, and nowhere else. The page does not
            keep it. The access token, if you use one, stays in the page's memory until you close it.
          </li>
          <li>
            Installing firmware downloads the firmware file from this same site and writes it to your Zenit over the USB
            cable.
          </li>
        </ul>
      </Card>
      <Card aria-labelledby="privacy-about">
        <CardTitle id="privacy-about">About this app</CardTitle>
        <p className="mb-3 text-base" data-testid="app-version">
          Version {__APP_VERSION__}
        </p>
        <ul className="text-base">
          <li>
            <a className={link} href={__REPOSITORY_URL__} rel="noreferrer noopener">
              Source code
            </a>
          </li>
          <li>
            <a className={link} href="./LICENSE.txt">
              License
            </a>
            {" and "}
            <a className={link} href="./LICENSE-EXCEPTION.txt">
              additional permission
            </a>
          </li>
          <li>
            <a className={link} href="./THIRD_PARTY_NOTICES.txt">
              Third-party notices
            </a>
          </li>
        </ul>
      </Card>
    </>
  );
}
