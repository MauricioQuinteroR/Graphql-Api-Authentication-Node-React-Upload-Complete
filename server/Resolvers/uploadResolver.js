const { readFile, multipleReadFile } = require("../Middlewares/file");
const { SingleFile } = require("../Model/singleUploadModel");
const { MultipleFile } = require("../Model/multipleUpload");
const { User } = require("../Model/user");
const { Follow } = require("../Model/follow");
const { Comment } = require("../Model/comment");
const { Like } = require("../Model/like");
const { Publication } = require("../Model/publication");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { parse, join } = require("path");
const { awsUploadImage, awsDeleteS3 } = require("../utils/aws-upload-image");
const { nanoid } = require("nanoid");



function createToken(user, SECRET_KEY, expiresIn) {
    const { id, name, email, username } = user;
    const payload = {
        id,
        name,
        email,
        username,
    };
    return jwt.sign(payload, SECRET_KEY, { expiresIn });
}

module.exports = {
    Query: {
        // Saludo En La Raiz
        greetings: () => {
            return "Bienvenido";
        },

        // getUser: (_, { id, username }) => userController.getUser(id, username),
        getUser: async (_, { id, username }) => {
            let user = null;
            if (id) user = await User.findById(id);
            if (username) user = await User.findOne({ username });
            if (!user) throw new Error("El usuario no existe");

            return user;
        },

        // Busqueda de usuarios
        search: async (_, { search }) => {
            const users = await User.find({
                name: { $regex: search, $options: "i" },
            });
            return users;
        },

        // Follow
        // comprueba si un usuario sigue a otro usuario
        isFollow: async (_, { username }, context) => {
            const userFound = await User.findOne({ username });
            if (!userFound) throw new Error("Usuario no encontrado");

            const follow = await Follow.find({ idUser: context.user.id })
                .where("follow")
                .equals(userFound._id);

            if (follow.length > 0) {
                return true;
            }
            return false;
        },
        // Obtener todos los seguidores de un usuario
        getFollowers: async (_, { username }) => {
            const userFound = await User.findOne({ username });
            if (!userFound) throw new Error("Usuario no encontrado");
            // populate trae todos los datos de idUser
            const followers = await Follow.find({
                follow: userFound._id,
            }).populate("idUser");

            const followersList = [];
            // Hacemos un for asyncrono
            for await (const data of followers) {
                if (data.idUser) followersList.push(data.idUser);
            }

            return followersList;
        },

        getFollowersByMe: async (_, { username }) => {
            const userFound = await User.findOne({ username });
            // populate trae todos los datos de follow
            const followersByMe = await Follow.find({
                idUser: userFound._id,
            }).populate("follow");
            //console.log(followersByMe);
            const followersByMeList = [];
            // Hacemos un for asyncrono
            for await (const data of followersByMe) {
                if (data.follow) followersByMeList.push(data.follow);
            }

            return followersByMeList;
        },

        getNotFolloweds: async (_, { }, context) => {
            // Traemos 50 usuarios
            const users = await User.find().limit(50);
            // Ahora vamos a separar los usuarios que seguimos a los que no
            const arrayUsers = [];
            for await (const user of users) {
                // arrayUsers.push(user);
                const isFind = await Follow.findOne({ idUser: context.user.id }).where("follow").equals(user._id);
                
                if (!isFind) {
                    if (user._id.toString() !== context.user.id.toString()) {
                        arrayUsers.push(user);
                    }
                }
            }
            return arrayUsers;
        },

        // Publications
        getPublications: async (_, { username }) => {
            const user = await User.findOne({ username });
            if (!user) throw new Error("Usuario no encontrado.");

            const publications = await Publication.find()
                .where({ idUser: user._id })
                .sort({ createAt: -1 });

            return publications;
        },

        getPublicationsFolloweds: async (_, {}, context) => {
            const followeds = await Follow.find({
                idUser: context.user.id,
            }).populate("follow");

            const followedsList = [];
            for await (const data of followeds) {
                followedsList.push(data.follow);
            }

            const publicationList = [];
            for await (const data of followedsList) {
                const publications = await Publication.find()
                    .where({
                        idUser: data._id,
                    })
                    .sort({ createAt: -1 })
                    .populate("idUser")
                    .limit(5);
                publicationList.push(...publications);
            }

            const result = publicationList.sort((a, b) => {
                return new Date(b.createAt) - new Date(a.createAt);
            });
            return result;
        },

        // Comments
        getComments: async (_, { idPublication }) => {
            const result = await Comment.find({ idPublication }).populate(
                "idUser"
            );

            return result;
        },

        // Like
        isLike: async (_, { idPublication }, context) => {
            try {
                const result = await Like.findOne({ idPublication }).where({
                    idUser: context.user.id,
                });
                if (!result) throw new Error("No le a dado like");
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },

        countLikes: async (_, { idPublication }) => {
            try {
                const result = await Like.countDocuments({ idPublication });
                return result;
            } catch (error) {
                console.log(error);
            }
        },
    },
    Mutation: {
        // register: (_, { input }) => userController.register(input),
        register: async (_, { input }) => {
            console.log("INPUTREGISTERMAO", input);
            const newUser = input;
            // Convertimos a minusculas el email y username
            newUser.email = newUser.email.toLowerCase();
            newUser.username = newUser.username.toLowerCase();
            const { email, username, password } = newUser;
            // Revisamos si el email esta en uso
            const foundEmail = await User.findOne({ email });
            if (foundEmail) throw new Error("El email ya existe");
            // Revisamos si el username esta en uso
            const foundUserName = await User.findOne({ username });
            if (foundUserName) throw new Error("El usermail ya existe");
            // Encriptar
            const salt = await bcryptjs.genSaltSync(10);
            newUser.password = await bcryptjs.hash(password, salt);
            try {
                const user = new User(newUser);
                user.save();
                return user;
            } catch (error) {
                console.log(error);
            }
        },
        // login: (_, { input }) => userController.login(input),
        login: async (_, { input }) => {
            console.log("INPUTMAOLOGIN", input);
            const { email, password } = input;
            const userFound = await User.findOne({
                email: email.toLowerCase(),
            });
            if (!userFound) throw new Error("Error en el email o contraseña");
            const passwordSucess = await bcryptjs.compare(
                password,
                userFound.password
            );
            if (!passwordSucess)
                throw new Error("Error en el email o contraseña");
            return {
                // token: createToken(userFound, process.env.SECRET_KEY, "1h"),
                // token: createToken(userFound, process.env.SECRET_KEY, "20d"),
                // token: createToken(userFound, process.env.SECRET_KEY, "120"), ms
                token: createToken(userFound, process.env.SECRET_KEY, "1d"),
            };
        },
        // updateAvatar: (_, { file }) => userController.updateAvatar(file),
        updateAvatar: async (_, { file }, context) => {
            // sacamos la id del usuario del contexto extraido del token en apollo.js
            //enviado desde el front
            const { id } = context.user;
            // con el id buscamos la urlAvatar en la bd para borrar la actual antes de subir la nueva
            const userX = await User.findById(id);
            // borramos el avatar actual
            if (userX.avatar) {
                try {
                    const deleteActual = await awsDeleteS3(userX.avatar);
                    // console.log("Borrado avaatr anterior: ", deleteActual);
                } catch (error) {
                    console.log(error);
                }
            }
            const { createReadStream, filename } = await file;
            // sacamos la extencion del archivo
            var { ext, name } = parse(filename);
            // avatar es el nombre de la carpeta en S3
            const uuidNew = nanoid();
            const imageName = `avatar/${id}-${name}-${uuidNew}${ext}`;
            // cada vez que se cambie el avatar sobreescribira el que esta.
            const fileData = createReadStream();
            try {
                // Opcion de guardar en el servidor los archivos con las siguientes dos lineas
                // const imageUrl = await readFile(file);
                // const singlefile = new SingleFile({ image: imageUrl });

                const result = await awsUploadImage(fileData, imageName);
                // guardamos el link del avatar subido en la BD
                await User.findByIdAndUpdate(id, { avatar: result });
                // Retornamos status y la url del avatar
                return {
                    status: true,
                    urlAvatar: result,
                };
            } catch (error) {
                return {
                    status: false,
                    urlAvatar: null,
                };
            }
        },
        // los datos del avatar a borrar llegan por el contexto
        deleteAvatar: async (_, {}, context) => {
            // sacamos el id del contexto
            // el contexto llega por los headers y se configura en el archivo apollo.js
            const { id } = context.user;
            // con el id buscamos la urlAvatar en la bd para borrar la actual antes de subir la nueva
            const userX = await User.findById(id);
            // borramos el avatar actual
            if (userX.avatar) {
                try {
                    const deleteActual = await awsDeleteS3(userX.avatar);
                    // console.log("Borrado de avatar anterior: ", deleteActual);
                } catch (error) {
                    console.log(error);
                }
            }
            // reseteamos a "" la urlAvatar
            try {
                await User.findByIdAndUpdate(id, { avatar: "" });
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },

        updateUser: async (_, { input }, context) => {
            // sacamos el id del contexto
            // el contexto llega por los headers y se configura en el archivo apollo.js
            const { id } = context.user;

            try {
                if (input.currentPassword && input.newPassword) {
                    // Traemos la contraseña guardada, y comparamos con la contraseña enviada
                    const userFound = await User.findById(id);
                    const passwordSucess = await bcryptjs.compare(
                        input.currentPassword,
                        userFound.password
                    );
                    if (!passwordSucess)
                        throw new Error("Contraseña Incorrecta");

                    const salt = await bcryptjs.genSaltSync(10);
                    const newPaswordCrypt = await bcryptjs.hash(
                        input.newPassword,
                        salt
                    );

                    await User.findByIdAndUpdate(id, {
                        password: newPaswordCrypt,
                    });
                } else {
                    await User.findByIdAndUpdate(id, input);
                }
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },

        singleUpload: async (_, { file }) => {
            const imageUrl = await readFile(file);
            const singlefile = new SingleFile({ image: imageUrl });
            await singlefile.save();
            return {
                message: "Subida de archivo OK!",
            };
        },

        multipleUpload: async (_, { file }) => {
            const imageUrl = await multipleReadFile(file);
            const multiplefile = new MultipleFile();
            multiplefile.images.push(...imageUrl);
            multiplefile.save();
            return {
                message: "Subida de multiples archivos OK!",
            };
        },

        // Seccion De Follow
        follow: async (_, { username }, context) => {
            const userFound = await User.findOne({ username });
            if (!userFound) throw new Error("Usuario no encontrado");

            try {
                const follow = new Follow({
                    idUser: context.user.id,
                    follow: userFound._id,
                });
                follow.save();
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },

        unFollow: async (_, { username }, context) => {
            const userFound = await User.findOne({ username });
            const follow = await Follow.deleteOne({ idUser: context.user.id })
                .where("follow")
                .equals(userFound._id);
            if (follow.deletedCount > 0) {
                return true;
            }
            return false;
        },

        // publish: (_, { file }) => userController.publish(file),
        publish: async (_, { file }, context) => {
            // sacamos la id del usuario del contexto extraido del token en apollo.js
            //enviado desde el front
            const { id } = context.user;
            const { createReadStream, filename, mimetype } = await file;
            // sacamos la extension del archivo
            var { ext, name } = parse(filename);
            const uuidNew = nanoid();
            const fileName = `publication/${uuidNew}${ext}`;
            const fileData = createReadStream();
            // Ahora subimos a Amazon
            try {
                const result = await awsUploadImage(fileData, fileName);
                // guardamos el link de la publicacion subida en la BD
                const publication = new Publication({
                    idUser: id,
                    file: result,
                    typeFile: mimetype.split("/")[0],
                    createAt: Date.now(),
                });
                publication.save();
                // Retornamos status y la url de la publicacion
                return {
                    status: true,
                    urlFile: result,
                };
            } catch (error) {
                return {
                    status: false,
                    urlFile: null,
                };
            }
        },

        // Comment
        addComment: async (_, { input }, context) => {
            try {
                const comment = new Comment({
                    idPublication: input.idPublication,
                    idUser: context.user.id,
                    comment: input.comment,
                });
                comment.save();
                return comment;
            } catch (error) {
                console.log(error);
            }
        },

        // Like
        addLike: async (_, { idPublication }, context) => {
            try {
                const like = new Like({
                    idPublication,
                    idUser: context.user.id,
                });
                like.save();
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },
        addLike: async (_, { idPublication }, context) => {
            try {
                const like = new Like({
                    idPublication,
                    idUser: context.user.id,
                });
                like.save();
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },
        deleteLike: async (_, { idPublication }, context) => {
            try {
                await Like.findOneAndDelete({ idPublication }).where({
                    idUser: context.user.id,
                });
                return true;
            } catch (error) {
                console.log(error);
                return false;
            }
        },
    },
};