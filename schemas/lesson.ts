import { z } from 'zod';
export const regions = ['top','working-area','explanation-area','graph-area','result-area'] as const;
export const actionTypes = ['write_text','write_latex','highlight','unhighlight','draw_line','draw_arrow','draw_circle','draw_rectangle','draw_axes','plot_point','plot_points','plot_graph','show_label','show_image','show_book_reference','move_object','erase_object','clear_region','clear_board','focus_object','group_objects','wait','change_emphasis'] as const;
const ID=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const pointSchema=z.object({x:z.number().min(-10).max(10),y:z.number().min(-10).max(10)}).strict();
export const actionSchema=z.object({
 type:z.enum(actionTypes), id:ID.nullable(), content:z.string().max(1400).nullable(),
 region:z.enum(regions), targets:z.array(ID).max(30),
 points:z.array(pointSchema).max(180), color:z.enum(['ink','blue','teal','amber','red']),
 // geometry uses normalized 0–100 coordinates inside a fixed SVG canvas, never page pixels.
 geometry:z.object({x:z.number().min(0).max(100),y:z.number().min(0).max(100),width:z.number().min(0).max(100),height:z.number().min(0).max(100)}).strict().nullable(),
 delayMs:z.number().int().min(0).max(5000)
}).strict();
export const segmentSchema=z.object({id:ID,narration:z.string().min(1).max(1300),goal:z.string().max(150),sourceChunkIds:z.array(z.string().max(100)).min(1).max(6),actions:z.array(actionSchema).min(1).max(18)}).strict();
export const generatedLessonSchema=z.object({title:z.string().min(1).max(100),mode:z.enum(['new','followup']),sufficientContext:z.boolean(),message:z.string().max(500),segments:z.array(segmentSchema).max(12)}).strict();
export type Action=z.infer<typeof actionSchema>;
export type Segment=z.infer<typeof segmentSchema> & {sources:Source[]};
export type Source={chunkId:string;sourceId:string;pdfPage:number;printedPage:number|null;lesson:string;image:string};
export type Lesson=Omit<z.infer<typeof generatedLessonSchema>,'segments'> & {id:string;question:string;segments:Segment[];sources:Source[]};
export type BoardObject={id:string;type:Action['type'];content:string;region:typeof regions[number];points:Action['points'];geometry:Action['geometry'];color:Action['color'];highlighted:boolean;focused:boolean;group:string|null};
export type BoardState={objects:BoardObject[]};
export const emptyBoard=():BoardState=>({objects:[]});
export const boardSchema=z.object({objects:z.array(z.object({id:ID,type:z.enum(actionTypes),content:z.string().max(1400),region:z.enum(regions),points:z.array(pointSchema).max(180),geometry:actionSchema.shape.geometry,color:actionSchema.shape.color,highlighted:z.boolean(),focused:z.boolean(),group:ID.nullable()}).strict()).max(150)}).strict();
