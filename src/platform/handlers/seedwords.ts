// Ported from the SeedWords* ipcMain.handle handlers in the desktop src/index.js.
import seedwords from "seed-words";

export default {
  async SeedWordsInitialize() {
    return await seedwords.initialize();
  },

  async SeedWordsGetAllWords() {
    return seedwords.getAllSeedWords();
  },

  async SeedWordsGetWordList(data: any) {
    return seedwords.getWordListFromSeedArray(data);
  },

  async SeedWordsGetSeedArray(data: any) {
    return seedwords.getSeedArrayFromWordList(data);
  },

  async SeedWordsDoesWordExist(data: any) {
    return seedwords.doesSeedWordExist(data);
  },
};
