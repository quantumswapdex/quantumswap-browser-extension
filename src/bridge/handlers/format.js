// Ported from the FormatApi* ipcMain.handle handlers in the desktop src/index.js.
import { parseEther, formatEther, FixedNumber } from "quantumcoin";

export default {
  async FormatApiEtherToWei(data) {
    return parseEther(data);
  },

  async FormatApiWeiToEther(data) {
    return formatEther(data);
  },

  async FormatApiWeiToEtherCommified(data) {
    const etherAmount = formatEther(data);
    return etherAmount.toLocaleString();
  },

  async FormatApiIsValidEther(data) {
    try {
      if (data.startsWith("0")) {
        return false;
      }
      const number = FixedNumber.fromString(data);
      const isNegative = number.isNegative();
      return !isNegative;
    } catch (error) {
      return false;
    }
  },

  async FormatApiCompareEther(data) {
    try {
      const number1 = FixedNumber.fromString(data.num1.replaceAll(",", ""));
      const number2 = FixedNumber.fromString(data.num2.replaceAll(",", ""));
      if (number1.isNegative() || number2.isNegative()) {
        throw new Error("error parsing numbers. negative values.");
      }

      if (number1.eq(number2)) {
        return 0;
      } else if (number1.gt(number2)) {
        return 1;
      } else {
        return -1;
      }
    } catch (error) {
      throw new Error("error parsing numbers");
    }
  },
};
