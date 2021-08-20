import fetch from 'node-fetch';

import logger from '../logger.js';
import DownlinkDataModel from '../models/downlink-data.model.js';
import { translateUplink, translateDownlink } from '../services/nit-ttn.service.js';
import sendToTPXLEAsync from '../services/send-to-tpxle.js';

export const uplinkFromTTN = async (req, res) => {
  /* ** Check if request body is correct ** */
  const errMsg =
    'UL: (x-access-token or (x-client-id and x-client-secret)), x-downlink-push, x-downlink-replace, x-downlink-apikey in header and end_device_ids.dev_eui in body are mandatory!';
  let accessToken;
  let clientID;
  let clientSecret;
  let devEUI;
  let downlinkPush;
  let downlinkReplace;
  let downlinkApikey;
  try {
    accessToken = req.headers['x-access-token'];
    clientID = req.headers['x-client-id'];
    clientSecret = req.headers['x-client-secret'];
    devEUI = req.body.end_device_ids.dev_eui;
    downlinkPush = req.headers['x-downlink-push'];
    downlinkReplace = req.headers['x-downlink-replace'];
    downlinkApikey = req.headers['x-downlink-apikey'];
  } catch (err) {
    logger.warn(err.stack);
    logger.warn(errMsg);
    res.status(400).send(errMsg);
    return;
  }
  if (
    !(
      (accessToken || (clientID && clientSecret)) &&
      devEUI &&
      downlinkPush &&
      downlinkReplace &&
      downlinkApikey
    )
  ) {
    logger.warn(errMsg);
    res.status(400).send(errMsg);
    return;
  }
  logger.debug(`UL: DevEUI: ${devEUI}: UL message received from NS.`);

  /* ** Save downlink data in db ** */
  DownlinkDataModel.setDLData('ttn', devEUI, {
    downlinkPush,
    downlinkReplace,
    downlinkApikey,
  });

  /* ** Translate message body ** */
  let translatedBody;
  try {
    translatedBody = translateUplink(req.body);
  } catch (err) {
    logger.error(err.stack);
    res.status(400).send('Invalid request body. (Failed to translate request body.)\n');
    return;
  }

  sendToTPXLEAsync(translatedBody, accessToken, clientID, clientSecret);

  res.status(200).end();
};

export const downlinkToTTN = async (req, res) => {
  /* ** Check if request body is correct ** */
  const devEUI = req.body.deveui?.toLowerCase();
  if (!devEUI) {
    logger.warn(`DL: There is no "deveui" field in request body.`);
    res.write('There is no "deveui" field in request body.');
    res.status(400).end();
    return;
  }
  logger.debug(`DL: DevEUI: ${devEUI}: DL message received from TPXLE.`);

  /* ** Translate message body ** */
  let translatedBody;
  try {
    translatedBody = translateDownlink(req.body);
  } catch (err) {
    logger.error(err.stack);
    res.status(400).send('Invalid request body. (Failed to translate request body.)\n');
    return;
  }

  /* ** Get downlinkData from DB. ** */
  let downlinkData;
  try {
    downlinkData = await DownlinkDataModel.getDLData('ttn', devEUI);
  } catch (err) {
    logger.error(err.stack);
    res.status(500).end();
    return;
  }
  if (!downlinkData) {
    logger.warn(`DL: DevEUI: ${devEUI}: DownlinkData does not exists in the db yet.`);
    res.status(404).send(`DL: DevEUI: ${devEUI}: DownlinkData does not exists in the db yet.\n`);
    return;
  }
  logger.debug(
    `DL: DevEUI: ${devEUI}: downlinkData retreived from DB: ${JSON.stringify(downlinkData)}`,
  );

  /* ** Send downlink frame to NS ** */
  let nsRes;
  try {
    nsRes = await fetch(downlinkData.downlinkReplace, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${downlinkData.downlinkApikey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(translatedBody),
    });
  } catch (err) {
    logger.error(err.stack);
    res.status(200).end();
    return;
  }
  logger.debug(
    `DL: DevEUI: ${devEUI}: Downlink forwarded to NS. Response status: ${nsRes.status} ${nsRes.statusText}`,
  );

  let nsResText;
  try {
    nsResText = await nsRes.text();
  } catch (err) {
    logger.error(err.stack);
    return;
  }
  if (nsResText) {
    logger.debug(nsResText);
  }

  res.status(200).end();
};
