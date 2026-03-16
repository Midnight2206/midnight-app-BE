/**
 * @swagger
 * tags:
 *   - name: Category
 *     description: Category management APIs
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Category:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: 550e8400-e29b-41d4-a716-446655440000
 *         name:
 *           type: string
 *           example: Khánh1
 *         sizes:
 *           type: array
 *           items:
 *             type: string
 *             example: "40"
 *         createdAt:
 *           type: string
 *           format: date-time
 *
 *     CategoryPayload:
 *       type: object
 *       required:
 *         - name
 *         - sizes
 *       properties:
 *         name:
 *           type: string
 *           example: Khánh1
 *         sizes:
 *           type: array
 *           minItems: 1
 *           items:
 *             type: string
 *           example:
 *             - "38"
 *             - "39"
 *             - "40"
 *             - "41"
 *             - "44"
 *             - "45"
 *
 *   responses:
 *     Unauthorized:
 *       description: Unauthorized
 */
/**
 * @swagger
 * /api/categories:
 *   get:
 *     tags: [Category]
 *     summary: Get all categories
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query for category name
 *
 *       - in: query
 *         name: deleted
 *         schema:
 *           type: string
 *           enum: [deleted, active, all]
 *         description: Filter by deleted status
 *
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, name]
 *         description: Sort by field
 *
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api/categories/exists:
 *   post:
 *     tags: [Category]
 *     summary: Check category exists
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Check result
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api/categories:
 *   post:
 *     tags: [Category]
 *     summary: Create category
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CategoryPayload'
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api/categories/{id}:
 *   patch:
 *     tags: [Category]
 *     summary: Update category
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CategoryPayload'
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api/categories/{id}:
 *   delete:
 *     tags: [Category]
 *     summary: Delete category
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api/categories/{id}/restore:
 *   post:
 *     tags: [Category]
 *     summary: Restore category
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Restored
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
