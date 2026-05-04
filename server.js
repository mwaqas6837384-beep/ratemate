import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 8085;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
  }
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const BILL_SCHEMA = {
  type: "OBJECT",
  properties: {
    success: { type: "BOOLEAN" },
    document_type: { type: "STRING" },

    supplier: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        ntn: { type: "STRING" },
        strn: { type: "STRING" },
        phone: { type: "STRING" },
        address: { type: "STRING" }
      },
      required: ["name", "ntn", "strn", "phone", "address"]
    },

    bill: {
      type: "OBJECT",
      properties: {
        bill_number: { type: "STRING" },
        bill_date: { type: "STRING" },
        currency: { type: "STRING" }
      },
      required: ["bill_number", "bill_date", "currency"]
    },

    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          product_name: { type: "STRING" },
          barcode: { type: "STRING" },

          quantity: { type: "NUMBER" },
          unit: { type: "STRING" },

          carton_quantity: { type: "NUMBER" },
          loose_quantity: { type: "NUMBER" },
          units_per_carton: { type: "NUMBER" },
          total_units: { type: "NUMBER" },

          unit_rate: { type: "NUMBER" },
          retail_price: { type: "NUMBER" },
          trade_price_ex_tax: { type: "NUMBER" },

          gross_amount: { type: "NUMBER" },
          value_ex_tax: { type: "NUMBER" },
          discount_amount: { type: "NUMBER" },
          value_after_discount: { type: "NUMBER" },
          trade_offer_amount: { type: "NUMBER" },
          tax_percent: { type: "NUMBER" },
          tax_amount: { type: "NUMBER" },

          net_amount: { type: "NUMBER" },
          final_amount: { type: "NUMBER" },

          confidence: { type: "NUMBER" },
          raw_line: { type: "STRING" }
        },
        required: [
          "product_name",
          "barcode",
          "quantity",
          "unit",
          "carton_quantity",
          "loose_quantity",
          "units_per_carton",
          "total_units",
          "unit_rate",
          "retail_price",
          "trade_price_ex_tax",
          "gross_amount",
          "value_ex_tax",
          "discount_amount",
          "value_after_discount",
          "trade_offer_amount",
          "tax_percent",
          "tax_amount",
          "net_amount",
          "final_amount",
          "confidence",
          "raw_line"
        ]
      }
    },

    summary: {
      type: "OBJECT",
      properties: {
        subtotal: { type: "NUMBER" },
        total_tax: { type: "NUMBER" },
        total_discount: { type: "NUMBER" },
        grand_total: { type: "NUMBER" },
        item_count: { type: "NUMBER" }
      },
      required: [
        "subtotal",
        "total_tax",
        "total_discount",
        "grand_total",
        "item_count"
      ]
    },

    warnings: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  },
  required: [
    "success",
    "document_type",
    "supplier",
    "bill",
    "items",
    "summary",
    "warnings"
  ]
};

app.get("/", (req, res) => {
  res.json({
    status: true,
    message: "RateMate Gemini backend is running",
    endpoints: {
      parse_bill: "POST /api/parse-bill"
    }
  });
});

app.post("/api/parse-bill", upload.single("bill"), async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        status: false,
        error: "GEMINI_API_KEY is missing in .env"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: false,
        error: "Please upload bill image using form-data field name: bill"
      });
    }

    const mimeType = req.file.mimetype || "image/jpeg";

    if (!mimeType.startsWith("image/")) {
      return res.status(400).json({
        status: false,
        error: "Uploaded file must be an image"
      });
    }

    const base64Image = req.file.buffer.toString("base64");

    const prompt = `
You are RateMate, a smart grocery supplier bill extraction engine.

Your job:
Extract ONLY real product/item rows from the bill image.

Important rules:
- Do NOT save NTN as product.
- Do NOT save CNIC as product.
- Do NOT save STRN as product.
- Do NOT save phone number as product.
- Do NOT save address as product.
- Do NOT save invoice number as product.
- Do NOT save shop name or supplier name as product.
- Do NOT save subtotal, grand total, tax total, cash, balance, footer, or thank-you text as product.
- If product rows are unclear, return fewer items with warnings instead of guessing.
- Use empty string for missing text fields.
- Use 0 for missing number fields.
- confidence must be between 0 and 1.
- document_type should be supplier_bill, receipt, invoice, or unknown.
- Currency should usually be PKR if Pakistani rupees are shown.

For supplier bill table columns, map carefully:

Product column:
- product_name

Qty columns:
- Qty Ctn = carton_quantity
- Qty Pcs = loose_quantity
- quantity should be carton_quantity if carton_quantity is greater than 0, otherwise loose_quantity
- unit should be "carton" if carton_quantity is greater than 0, otherwise "pcs"

Trade Offer columns:
- Trade Offer Rs = trade_offer_amount

Price columns:
- Retail Price = retail_price
- unit_rate should also be retail_price
- Trade Price Ex. Tax = trade_price_ex_tax

Amount columns:
- Value Ex Tax = value_ex_tax
- gross_amount should also be value_ex_tax
- Disc. = discount_amount
- Value After Disc. = value_after_discount
- Sales Tax = tax_amount
- Net Rate After T.O = final_amount
- net_amount must also be Net Rate After T.O

Very important:
- Do NOT put Value After Disc. into net_amount.
- Do NOT put Value After Disc. into final_amount.
- final_amount and net_amount must be the final payable amount for that product row after discount, tax, and trade offer.
- For example, if a row has Value After Disc. 3568.88, Sales Tax 730.37, Trade Offer Rs 72.00, and Net Rate After T.O 4227.25, then:
  value_after_discount = 3568.88
  tax_amount = 730.37
  trade_offer_amount = 72.00
  final_amount = 4227.25
  net_amount = 4227.25

Units:
- If total_units is not printed, estimate it using Value Ex Tax / Trade Price Ex Tax.
- Example: 3786.61 / 315.5508 = about 12, so total_units = 12.
- units_per_carton = total_units / carton_quantity when carton_quantity is greater than 0.
- For loose piece rows, total_units should equal loose_quantity.

Return clean JSON only.
`;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: BILL_SCHEMA
        }
      })
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return res.status(500).json({
        status: false,
        error: "Gemini API error",
        details: geminiData
      });
    }

    const text =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({
        status: false,
        error: "Gemini returned empty response",
        details: geminiData
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(cleanJsonText(text));
      parsed = normalizeParsedBill(parsed);
    } catch (error) {
      return res.status(500).json({
        status: false,
        error: "Gemini returned invalid JSON",
        raw: text
      });
    }

    return res.json({
      status: true,
      data: parsed
    });
  } catch (error) {
    console.error("Parse bill error:", error);

    return res.status(500).json({
      status: false,
      error: error.message || "Failed to parse bill"
    });
  }
});

function cleanJsonText(text) {
  return text
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeParsedBill(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  if (!Array.isArray(parsed.items)) {
    parsed.items = [];
  }

  parsed.items = parsed.items.map((item) => normalizeBillItem(item));

  return parsed;
}

function normalizeBillItem(item) {
  const cartonQuantity = numberValue(item.carton_quantity);
  const looseQuantity = numberValue(item.loose_quantity);
  const unitsPerCartonOriginal = numberValue(item.units_per_carton);

  const retailPrice = numberValue(item.retail_price) || numberValue(item.unit_rate);
  const tradePriceExTax = numberValue(item.trade_price_ex_tax);

  const valueExTax = numberValue(item.value_ex_tax) || numberValue(item.gross_amount);
  const valueAfterDiscount = numberValue(item.value_after_discount);
  const discountAmount = numberValue(item.discount_amount);
  const tradeOfferAmount = numberValue(item.trade_offer_amount);
  const taxAmount = numberValue(item.tax_amount);

  let totalUnits = numberValue(item.total_units);

  if (totalUnits <= 0 && valueExTax > 0 && tradePriceExTax > 0) {
    totalUnits = roundTo(valueExTax / tradePriceExTax, 2);
  }

  if (totalUnits <= 0 && cartonQuantity > 0 && unitsPerCartonOriginal > 0) {
    totalUnits = roundTo((cartonQuantity * unitsPerCartonOriginal) + looseQuantity, 2);
  }

  if (totalUnits <= 0) {
    totalUnits = looseQuantity > 0 ? looseQuantity : numberValue(item.quantity);
  }

  let unitsPerCarton = unitsPerCartonOriginal;

  if (unitsPerCarton <= 0 && cartonQuantity > 0 && totalUnits > 0) {
    unitsPerCarton = roundTo((totalUnits - looseQuantity) / cartonQuantity, 2);
  }

  let finalAmount = numberValue(item.final_amount);
  let netAmount = numberValue(item.net_amount);

  if (finalAmount <= 0) {
    finalAmount = netAmount;
  }

  const looksLikeValueAfterDiscount =
    valueAfterDiscount > 0 && Math.abs(finalAmount - valueAfterDiscount) < 0.02;

  if ((finalAmount <= 0 || looksLikeValueAfterDiscount) && valueAfterDiscount > 0) {
    finalAmount = valueAfterDiscount + taxAmount - tradeOfferAmount;
  }

  if (netAmount <= 0 || Math.abs(netAmount - valueAfterDiscount) < 0.02) {
    netAmount = finalAmount;
  }

  return {
    ...item,
    product_name: String(item.product_name || "").trim(),
    barcode: String(item.barcode || "").trim(),

    carton_quantity: roundTo(cartonQuantity, 2),
    loose_quantity: roundTo(looseQuantity, 2),
    units_per_carton: roundTo(unitsPerCarton, 2),
    total_units: roundTo(totalUnits, 2),

    quantity: numberValue(item.quantity) || cartonQuantity || looseQuantity,
    unit: String(item.unit || (cartonQuantity > 0 ? "carton" : "pcs")).trim(),

    unit_rate: roundTo(retailPrice, 4),
    retail_price: roundTo(retailPrice, 4),
    trade_price_ex_tax: roundTo(tradePriceExTax, 4),

    gross_amount: roundTo(valueExTax, 2),
    value_ex_tax: roundTo(valueExTax, 2),
    discount_amount: roundTo(discountAmount, 2),
    value_after_discount: roundTo(valueAfterDiscount, 2),
    trade_offer_amount: roundTo(tradeOfferAmount, 2),
    tax_percent: roundTo(numberValue(item.tax_percent), 2),
    tax_amount: roundTo(taxAmount, 2),

    net_amount: roundTo(netAmount, 2),
    final_amount: roundTo(finalAmount, 2),

    confidence: Math.max(0, Math.min(1, numberValue(item.confidence))),
    raw_line: String(item.raw_line || "").trim()
  };
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(numberValue(value) * factor) / factor;
}

app.listen(port, () => {
  console.log(`RateMate Gemini backend running on http://localhost:${port}`);
});