// SPDX-License-Identifier: GPL-3.0-or-later

import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "../components/card";
import { Sentence, slot } from "../components/sentence";

const link = "inline-flex min-h-11 items-center font-medium text-primary underline";

export function PrivacyView() {
  const { t } = useTranslation("privacy");
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Card aria-labelledby="privacy-data">
        <CardTitle id="privacy-data">{t("data.title")}</CardTitle>
        <ul className="list-disc space-y-2 pl-5 text-base">
          <li>{t("data.nothingSent")}</li>
          <li>{t("data.ownFiles")}</li>
          <li>{t("data.localOnly")}</li>
          <li>{t("data.settings")}</li>
          <li>{t("data.stored")}</li>
          <li>{t("data.secrets")}</li>
          <li>{t("data.firmware")}</li>
        </ul>
      </Card>
      <Card aria-labelledby="privacy-about">
        <CardTitle id="privacy-about">{t("about.title")}</CardTitle>
        <p className="mb-3 text-base" data-testid="app-version">
          {t("about.version", { version: __APP_VERSION__ })}
        </p>
        <ul className="text-base">
          <li>
            <a className={link} href={__REPOSITORY_URL__} rel="noreferrer noopener">
              {t("about.source")}
            </a>
          </li>
          <li>
            <Sentence
              text={t("about.licenseLine", { license: slot("license"), permission: slot("permission") })}
              parts={{
                license: (
                  <a className={link} href="./LICENSE.txt">
                    {t("about.license")}
                  </a>
                ),
                permission: (
                  <a className={link} href="./LICENSE-EXCEPTION.txt">
                    {t("about.permission")}
                  </a>
                ),
              }}
            />
          </li>
          <li>
            <a className={link} href="./THIRD_PARTY_NOTICES.txt">
              {t("about.notices")}
            </a>
          </li>
        </ul>
      </Card>
    </>
  );
}
