// Generic Zod Request Body Validation Middleware
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errorDetails = (result.error.issues || []).map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));

    return res.status(400).json({
      success: false,
      error: `Validation error: ${errorDetails.map((e) => e.message).join(", ")}`,
      details: errorDetails,
    });
  }

  // Replace req.body with stripped, validated, and typed data
  req.body = result.data;
  next();
};
