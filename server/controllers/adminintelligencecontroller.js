const { appLogger } = require('../utils/logger');
const { getEnterpriseOverview, exportEnterpriseReport } = require('../services/enterpriseintelligenceservice');

function parseRangeDays(value, fallbackValue = 30) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallbackValue;
    }

    return Math.min(180, Math.max(7, Math.floor(parsed)));
}

exports.getOverview = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_intelligence' });

    try {
        const rangeDays = parseRangeDays(req.query?.rangeDays, 30);
        const overview = await getEnterpriseOverview({ rangeDays });

        return res.json({
            success: true,
            overview,
            generatedAt: overview.generatedAt,
            rangeDays
        });
    } catch (error) {
        logger.error('admin.intelligence.overview_failed', { error, query: req.query || {} });
        return res.status(500).json({ success: false, message: 'Unable to load enterprise intelligence overview.' });
    }
};

exports.exportReport = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_intelligence' });

    try {
        const rangeDays = parseRangeDays(req.query?.rangeDays, 30);
        const format = String(req.query?.format || 'csv').trim().toLowerCase();
        const reportType = String(req.query?.report || req.query?.reportType || 'analytics').trim().toLowerCase();

        if (!['csv', 'pdf'].includes(format)) {
            return res.status(400).json({ success: false, message: 'Unsupported export format. Use csv or pdf.' });
        }

        const exported = await exportEnterpriseReport({ format, reportType, rangeDays });

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', exported.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
        res.setHeader('Content-Length', String(exported.payload.length));
        return res.status(200).send(exported.payload);
    } catch (error) {
        logger.error('admin.intelligence.export_failed', {
            error,
            query: req.query || {}
        });

        return res.status(500).json({ success: false, message: 'Unable to generate enterprise report export.' });
    }
};
