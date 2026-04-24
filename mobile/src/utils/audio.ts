import { Audio } from "expo-av";

export const playSoundUrl = async (url: string): Promise<void> => {
  try {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync({ uri: url });
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  } catch (e) {
    console.error("playSoundUrl error:", e);
  }
};
