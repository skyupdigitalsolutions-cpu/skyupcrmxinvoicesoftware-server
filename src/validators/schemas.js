import * as yup from 'yup';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const objectId = yup.string().matches(OBJECT_ID, 'Invalid id');

const emptyToUndefined = (schema) =>
    schema.transform((value, original) =>
        original === '' || original === null ? undefined : value
    ).notRequired();

const dateStr = yup
    .string()
    .matches(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const attendanceStatusEnum = ['present', 'absent', 'late', 'half_day', 'leave', 'holiday'];

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginSchema = {
    body: yup.object({
        username: yup.string().min(3).max(40).required(),
        password: yup.string().min(1).required(),
    }),
};

export const forgotPasswordSchema = {
    body: yup.object({
        email: yup.string().email('Enter a valid email address').required('Email is required'),
    }),
};

export const resetPasswordSchema = {
    body: yup.object({
        token: yup.string().min(1).required('Reset token is required'),
        password: yup.string().min(6, 'Password must be at least 6 characters').max(100).required(),
    }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const createUserSchema = {
    body: yup.object({
        name: yup.string().min(2).max(80).required(),
        username: yup.string().min(3).max(40)
            .matches(/^[a-z0-9_.-]+$/i, 'Letters, numbers, . _ - only').required(),
        password: yup.string().min(6).max(100).required(),
        email: yup.string().email('Enter a valid email').notRequired().default(''),
        role: yup.string().oneOf(['admin', 'sales']).notRequired(),
    }),
};

export const updateUserSchema = {
    params: yup.object({ id: objectId.required() }),
    body: yup.object({
        name: yup.string().min(2).max(80).notRequired(),
        password: yup.string().min(6).max(100).notRequired(),
        email: yup.string().email('Enter a valid email').notRequired(),
        active: yup.boolean().notRequired(),
    }),
};

// ── Orders ────────────────────────────────────────────────────────────────────
const itemSchema = yup.object({
    modelCode: yup.string().min(1, 'Article number required').required('Article number required'),
    description: yup.string().default(''),
    size: yup.string().default(''),
    unit: yup.string().default('PAIR'),
    qty: yup.number().typeError('qty must be a number').min(0).required(),
    pieces: yup.number().typeError('pieces must be a number').min(0).default(0),
    price: yup.number().typeError('price must be a number').min(0).required(),
});

const orderBodyShape = {
    date: yup.date().notRequired(),
    customer: yup.string().min(1, 'Customer required').required('Customer required'),
    city: yup.string().default(''),
    country: yup.string().default('UAE'),
    mobile: yup.string().default(''),
    delivery: yup.string().default(''),
    // Delivery contact number — entered manually on the order form. Was
    // missing from this validation schema, which caused the strict
    // stripUnknown validator to silently delete it from every request
    // before it ever reached the controller (the field itself, the
    // controller's whitelist, and the model were all correct — this schema
    // was the one place nobody updated when the field was added).
    deliveryContact: yup.string().default(''),
    payTerms: yup.string().default('Cash on Delivery'),
    salesperson: yup.string().matches(OBJECT_ID, 'Invalid id').nullable().notRequired(),
    items: yup.array().of(itemSchema).min(1, 'At least one item required').required(),
    discount: yup.number().min(0).default(0),
    due: yup.number().min(0).default(0),
    status: yup.string().default('Pending'),
    notes: yup.string().default(''),
};

export const createOrderSchema = { body: yup.object(orderBodyShape) };

const orderPartialShape = {
    date: yup.date().notRequired(),
    customer: yup.string().min(1, 'Customer required').notRequired(),
    city: yup.string().notRequired(),
    country: yup.string().notRequired(),
    mobile: yup.string().notRequired(),
    delivery: yup.string().notRequired(),
    deliveryContact: yup.string().notRequired(),
    payTerms: yup.string().notRequired(),
    salesperson: yup.string().matches(OBJECT_ID, 'Invalid id').nullable().notRequired(),
    items: yup.array().of(itemSchema).min(1, 'At least one item required').notRequired(),
    discount: yup.number().min(0).notRequired(),
    due: yup.number().min(0).notRequired(),
    status: yup.string().notRequired(),
    notes: yup.string().notRequired(),
};

export const updateOrderSchema = {
    params: yup.object({ id: objectId.required() }),
    body: yup.object(orderPartialShape),
};

export const statusSchema = {
    params: yup.object({ id: objectId.required() }),
    body: yup.object({
        status: yup.string()
            .oneOf(['Pending', 'Confirmed', 'Packed', 'Market Delay', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'])
            .required(),
        note: yup.string().default(''),
    }),
};

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoiceItemsSchema = {
    params: yup.object({ id: objectId.required() }),
    body: yup.object({ items: yup.array().of(itemSchema).min(1).required() }),
};

export const invoicePaymentSchema = {
    params: yup.object({ id: objectId.required() }),
    body: yup.object({ paymentStatus: yup.string().oneOf(['Unpaid', 'Partial', 'Paid']).required() }),
};

export const idParam = { params: yup.object({ id: objectId.required() }) };

// ── Attendance ────────────────────────────────────────────────────────────────
export const attendanceReportQuery = {
    query: yup.object({
        startDate: emptyToUndefined(dateStr),
        endDate: emptyToUndefined(dateStr),
        userId: emptyToUndefined(yup.string().matches(OBJECT_ID, 'Invalid id')),
        status: emptyToUndefined(yup.string().oneOf(attendanceStatusEnum)),
    }),
};

export const attendanceUpsertSchema = {
    body: yup.object({
        user: objectId.required(),
        date: dateStr.required(),
        loginTime: yup.date().nullable().notRequired(),
        logoutTime: yup.date().nullable().notRequired(),
        crmStatus: yup.string().oneOf([...attendanceStatusEnum, null]).nullable().notRequired(),
        remarks: yup.string().max(300).default(''),
    }),
};

export const attendanceUpdateSchema = {
    params: yup.object({ id: objectId.required() }),
    body: yup.object({
        loginTime: yup.date().nullable().notRequired(),
        logoutTime: yup.date().nullable().notRequired(),
        crmStatus: yup.string().oneOf([...attendanceStatusEnum, null]).nullable().notRequired(),
        remarks: yup.string().max(300).notRequired(),
    }),
};

export const attendanceConfigSchema = {
    body: yup.object({
        lateAfterMinutes: yup.number().integer().min(0).max(1439).notRequired(),
        halfDayMinMinutes: yup.number().integer().min(0).max(1440).notRequired(),
        fullDayMinMinutes: yup.number().integer().min(0).max(1440).notRequired(),
        weeklyOffDays: yup.array().of(yup.number().integer().min(0).max(6)).max(7).notRequired(),
        shiftStart: yup.string().matches(/^\d{2}:\d{2}$/, 'Use HH:MM').notRequired(),
        shiftEnd: yup.string().matches(/^\d{2}:\d{2}$/, 'Use HH:MM').notRequired(),
        timezone: yup.string().min(1).max(64).notRequired(),
        holidays: yup.array().of(
            yup.object({
                date: dateStr.required(),
                name: yup.string().max(80).default('Holiday'),
            })
        ).max(100).notRequired(),
        office: yup.object({
            enabled: yup.boolean().notRequired(),
            lat: yup.number().nullable().notRequired(),
            lng: yup.number().nullable().notRequired(),
            radiusMeters: yup.number().min(10).max(5000).notRequired(),
        }).notRequired().default(undefined),
    }),
};

export const startBreakSchema = {
    body: yup.object({ reason: yup.string().max(60).default('Break') }),
};