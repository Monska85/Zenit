# Getting started with Zenit

Welcome. This page takes about five minutes to read and gets your Zenit from the box to a starry ceiling. You need no technical knowledge: a computer for the first setup, then a phone or a computer for everyday use.

## What Zenit is

Zenit is a star projector. One small, bright light sits under a dome full of tiny holes and projects stars on the ceiling. The light shows warm white, red, green or blue, steady or with gentle effects, and it can fade out by itself with a sleep timer. You control it from a web page, over your home WiFi.

Your Zenit has two USB-C sockets, side by side on the wall of its base:

- **The power socket**, fixed in the wall. The app calls it the panel power socket. This is the one you use every day: plug in an ordinary USB charger, such as a phone charger, or a power bank, and the light comes on.
- **The setup socket**, a little deeper, behind a small rectangular opening. It is used only to set up the WiFi with a computer. On this socket alone Zenit runs, but the light stays dark: it gets no power from it.

Not sure which is which? Plug a charger into one socket only. If the light comes on, that is the power socket.

Zenit arrives with everything installed, but it does not know your WiFi yet. The first setup below teaches it.

## Safety first

**Never connect a cable to the setup socket while the power socket is plugged in. Never use both at the same time.** Unplug the power socket first, then connect the computer's cable. When you are done, unplug that cable, then plug the power back in.

Do not look into the light from close by when it is bright.

## First setup: your WiFi

You need:

- A computer with Chrome or Edge. Other browsers, and most phones, cannot use a USB cable from a web page.
- A USB cable with USB-C at Zenit's end that carries data. Some cables only charge: if the computer does not find Zenit, try another cable.
- The name and the password of your home WiFi.

Then:

1. Unplug Zenit's power socket.
2. On the computer, open the Zenit page: <https://monska85.github.io/Zenit/>.
3. Connect the cable from the computer to Zenit's setup socket.
4. On the page, under "With a USB cable", press **Connect with USB**. The browser shows a list: choose Zenit (it may be called "USB JTAG/serial debug unit") and press **Connect**.
5. Open the **Device** page from the tabs. In the **WiFi** card, under "Set up the WiFi", press **Scan for networks** and pick yours from the list (or type its name), then type the password.
6. Press **Connect Zenit to this network**. It takes up to 30 seconds; keep the cable plugged in. If it fails, see "Zenit could not join the WiFi" below. Otherwise the page says "Connected as zenit-1a2b.local." with your Zenit's own name.
7. Write down that name (`zenit-1a2b.local` in this example: yours has other letters and digits). The WiFi card also shows it under **Address**, and a number like `192.168.1.20` under **Number**. Write that down too.
8. Unplug the cable from the setup socket. Then plug the charger into the power socket. The light fades in and Zenit joins your WiFi by itself.

Zenit remembers the network, also when it loses power.

## Everyday use

Use any phone, tablet or computer on the same WiFi as Zenit, in any up-to-date browser. Open Zenit's own page by its name:

```text
http://zenit-1a2b.local/
```

(with your Zenit's name in place of `zenit-1a2b`), or by its number:

```text
http://192.168.1.20/
```

The page comes from Zenit itself, so it connects by itself and works even when the internet is down. Add it to your bookmarks or to your phone's home screen, so it is one tap away.

On Android phones, names that end in `.local` often do not open: use the number instead. If an Android phone cannot open either, allow Chrome to find devices on your network: Settings, Apps, Chrome, Permissions, Nearby devices.

### The Light page

The **Light** page is where you spend your time. From top to bottom:

- **The power button**, the large round button, turns the light on and off. It glows in the color the light shows. The line beside it says what the light does now.
- **Brightness**, a slider from 1 to 100 %. Zenit changes when you let go of the slider.
- **Favorites**: your saved lights, each brought back with one tap, which also turns the light on. A new Zenit has two, Starry night and Christmas. **Save this light** keeps what the light shows now under a name you choose (up to 6 favorites). **Edit** lets you rename a favorite, give it the light as it is now, delete it, or choose **Turn on with this**: then Zenit shows that favorite whenever it gets power and whenever you turn the light on.
- **Effect**: Steady (one color, always the same), Color change, Breathing, Twinkle (a gentle shimmer, like a star), Fall asleep (dims slowly while the sleep timer runs), Christmas (slowly moves through a palette of colors), Shooting star (a calm sky with a bright flash now and then), Guided breathing (breathe in as it brightens and out as it dims, with the 4-7-8 or Box pattern), Jingle (pulses to the beat of Jingle Bells) and Hop (hops from color to color). The palettes are Christmas, Ice, Aurora, Sunset and All colors. Under the effects you find only the settings the chosen one uses, such as its color.
- **Sleep timer**: Off, 15 min, 30 min, 1 h, 2 h, or Custom (1 to 360 minutes, then **Set**). When the time is up, the light fades out over 30 seconds and stays off until you turn it on.

Zenit keeps your choices of brightness, effect, colors and timer, and your favorites. Turning the light off is not kept: after a power cut or when you plug it in again, the light comes back on, with your last light or with the favorite marked **Turn on with this**.

## Updates

Zenit keeps itself up to date. When a new version is published, it downloads and installs it by itself, both its own software (the firmware) and the page it serves. It needs your WiFi to reach the internet for this. While the firmware installs, the light goes dark for a moment and fades in again.

You find the version on the **Device** page, in the **Your Zenit** card next to **Firmware**, and the **Firmware** card says whether an update is available.

To change this, open **Advanced settings** on the Device page. In **Update settings**, "When a new version is published" offers **Off**, **Tell me** (Zenit tells you and you choose when to install) and **Install automatically** (the default). With **Install automatically**, the **Install window** sets the hours when Zenit may install; at first it may install at any time of day.

## Who can control Zenit

Anyone on your WiFi can open Zenit's page, and at first anyone can also control the light from it. To ask for a password first, turn on **Ask for a token to log in** in the **Access over WiFi** card of the Device page. The page still opens for everyone, but before it can control Zenit, each phone or computer types the token, 16 letters and digits, once when it connects.

The token is shown only when Zenit is connected to a computer by the setup socket, in that same card (**Show token**). Get the token before you turn the login on: connect it to a computer as in the first setup, write the token down, and keep it safe.

## When something does not work

**The page does not open or Zenit does not answer.**

- Check that the phone or computer is on the same WiFi as Zenit, and that Zenit has power (the charger in the power socket).
- Try the number address instead of the name, especially on Android.
- Zenit talks to one page at a time. Close Zenit's page on other phones, tabs and computers, then connect again. A page that was closed without warning, for example when a phone lost its WiFi, can hold Zenit for about half a minute.
- Your router may give Zenit a new number after a while. To read the current one, connect Zenit to a computer as in the first setup and look at the WiFi card.

**The computer does not find Zenit.** The list the browser shows is empty, or Zenit is not in it. Check that the cable is in the setup socket and the power socket is unplugged, and that you use Chrome or Edge on a computer. Try another cable: many cables only charge. Then unplug the cable, plug it in again and press **Connect with USB** again.

**Zenit could not join the WiFi.** Check the name and the password and try again. Zenit uses the 2.4 GHz WiFi band, which most home routers offer. If your router shows two networks, such as "HomeNet" and "HomeNet-5G", choose the one without 5G. Very old security settings (WEP, or WPA without WPA2) do not work.

**A new WiFi network**, a new router or a new password: Zenit cannot be moved to another network over WiFi. Do the first setup again with the computer and the cable.

**Back to how Zenit came.** With Zenit connected to a computer as in the first setup, the **Maintenance** card of the Device page has **Reset to defaults**. Every setting goes back to its default, Zenit forgets its WiFi network and makes a new token. Then set up the WiFi again.

**Still stuck?** Ask on the project's page: <https://github.com/Monska85/Zenit/issues>.
